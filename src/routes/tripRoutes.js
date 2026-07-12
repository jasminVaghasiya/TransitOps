import express from 'express';
import mongoose from 'mongoose';
import Trip from '../models/Trip.js';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import { protect } from '../middleware/auth.js';
import { attachAbility, authorize, policyGate } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { tripSchema, updateTripSchema } from '../validation/transitValidation.js';
import TripPolicy from '../policies/TripPolicy.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = express.Router();

router.use(protect);
router.use(attachAbility);

const loadTrip = async (req) => {
  return await Trip.findById(req.params.id);
};

// Transaction wrapper that falls back to sequential execution on standalone Mongo instances
const executeWithTransaction = async (operation) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await operation(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    // Check if error is due to lack of Replica Set (standalone MongoDB)
    if (
      error.codeName === 'CommandNotSupported' ||
      error.code === 20 ||
      error.message.toLowerCase().includes('transaction') ||
      error.message.toLowerCase().includes('replica set') ||
      error.message.toLowerCase().includes('replicaset')
    ) {
      await session.abortTransaction();
      console.warn('[TRANSACTION WARNING] Standalone MongoDB detected. Running operations sequentially.');
      // Execute the operation sequentially without session
      return await operation(null);
    }
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * @route   POST /api/trips
 * @desc    Create a new trip (Draft by default)
 */
router.post(
  '/',
  authorize('create', 'Trip'),
  validateBody(tripSchema),
  policyGate(TripPolicy, 'canCreate'),
  async (req, res, next) => {
    try {
      const trip = await Trip.create(req.body);

      await writeAuditLog(req, 'CREATE', 'Trip', trip._id, null, trip);

      res.status(201).json({
        status: 'success',
        message: 'Trip created in Draft status',
        data: { trip },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/trips
 * @desc    List all trips
 */
router.get('/', authorize('read', 'Trip'), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, sort = '-createdAt', status, vehicle, driver } = req.query;

    const query = { isDeleted: { $ne: true } };

    if (status) query.status = status;
    if (vehicle) query.vehicle = vehicle;
    if (driver) query.driver = driver;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const trips = await Trip.find(query)
      .populate('vehicle')
      .populate('driver')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await Trip.countDocuments(query);

    res.status(200).json({
      status: 'success',
      data: {
        trips,
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/trips/:id
 * @desc    Get trip by ID
 */
router.get('/:id', authorize('read', 'Trip'), async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.id).populate('vehicle').populate('driver');
    if (!trip) {
      return res.status(404).json({ status: 'fail', message: 'Trip not found' });
    }

    res.status(200).json({
      status: 'success',
      data: { trip },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/trips/:id
 * @desc    Update trip parameters or perform state transitions
 */
router.patch(
  '/:id',
  authorize('update', 'Trip'),
  validateBody(updateTripSchema),
  policyGate(TripPolicy, 'canUpdate', loadTrip),
  async (req, res, next) => {
    try {
      const oldTrip = req.target;
      const { status } = req.body;

      const updatedTrip = await executeWithTransaction(async (session) => {
        const options = session ? { session } : {};

        // 1. If status is changing, apply side effects on Vehicle & Driver status
        if (status && status !== oldTrip.status) {
          const newStatus = status;

          if (newStatus === 'Dispatched') {
            // Lock Vehicle & Driver to On Trip
            await Vehicle.findByIdAndUpdate(oldTrip.vehicle, { status: 'On Trip' }, options);
            await Driver.findByIdAndUpdate(oldTrip.driver, { status: 'On Trip' }, options);
          } else if (newStatus === 'Completed') {
            // Release Vehicle & Driver to Available
            await Vehicle.findByIdAndUpdate(oldTrip.vehicle, { status: 'Available' }, options);
            await Driver.findByIdAndUpdate(oldTrip.driver, { status: 'Available' }, options);
          } else if (newStatus === 'Cancelled') {
            // Restore Vehicle & Driver to Available if they were dispatched
            if (oldTrip.status === 'Dispatched') {
              await Vehicle.findByIdAndUpdate(oldTrip.vehicle, { status: 'Available' }, options);
              await Driver.findByIdAndUpdate(oldTrip.driver, { status: 'Available' }, options);
            }
          }
        }

        // 2. Perform the update on Trip
        return await Trip.findByIdAndUpdate(
          req.params.id,
          req.body,
          { new: true, runValidators: true, ...options }
        );
      });

      await writeAuditLog(req, 'UPDATE', 'Trip', req.params.id, oldTrip, updatedTrip);

      res.status(200).json({
        status: 'success',
        message: `Trip updated successfully. Status is now ${updatedTrip.status}`,
        data: { trip: updatedTrip },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   DELETE /api/trips/:id
 * @desc    Delete trip (Draft only)
 */
router.delete(
  '/:id',
  authorize('delete', 'Trip'),
  policyGate(TripPolicy, 'canDelete', loadTrip),
  async (req, res, next) => {
    try {
      const oldTrip = req.target;

      await Trip.findByIdAndUpdate(req.params.id, { isDeleted: true });

      await writeAuditLog(req, 'DELETE', 'Trip', req.params.id, oldTrip, { ...oldTrip.toJSON(), isDeleted: true });

      res.status(200).json({
        status: 'success',
        message: 'Trip deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
