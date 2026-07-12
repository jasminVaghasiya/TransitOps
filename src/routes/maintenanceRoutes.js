import express from 'express';
import mongoose from 'mongoose';
import Maintenance from '../models/Maintenance.js';
import Vehicle from '../models/Vehicle.js';
import { protect } from '../middleware/auth.js';
import { attachAbility, authorize, policyGate } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { maintenanceSchema, updateMaintenanceSchema } from '../validation/transitValidation.js';
import MaintenancePolicy from '../policies/MaintenancePolicy.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = express.Router();

router.use(protect);
router.use(attachAbility);

const loadMaintenance = async (req) => {
  return await Maintenance.findById(req.params.id);
};

const executeWithTransaction = async (operation) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await operation(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    if (
      error.codeName === 'CommandNotSupported' ||
      error.code === 20 ||
      error.message.toLowerCase().includes('transaction') ||
      error.message.toLowerCase().includes('replica set') ||
      error.message.toLowerCase().includes('replicaset')
    ) {
      await session.abortTransaction();
      return await operation(null);
    }
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * @route   POST /api/maintenance
 * @desc    Start maintenance for a vehicle (automatically sets Vehicle status to In Shop)
 */
router.post(
  '/',
  authorize('create', 'Maintenance'),
  validateBody(maintenanceSchema),
  policyGate(MaintenancePolicy, 'canCreate'),
  async (req, res, next) => {
    try {
      const maintenance = await executeWithTransaction(async (session) => {
        const options = session ? { session } : {};

        // 1. Create maintenance entry
        const record = await Maintenance.create([req.body], options);
        
        // 2. Set vehicle status to In Shop
        await Vehicle.findByIdAndUpdate(req.body.vehicle, { status: 'In Shop' }, options);

        return record[0];
      });

      await writeAuditLog(req, 'CREATE', 'Maintenance', maintenance._id, null, maintenance);

      res.status(201).json({
        status: 'success',
        message: 'Maintenance logged. Vehicle is now In Shop.',
        data: { maintenance },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/maintenance
 * @desc    List all maintenance entries
 */
router.get('/', authorize('read', 'Maintenance'), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, sort = '-createdAt', status, vehicle } = req.query;

    const query = { isDeleted: { $ne: true } };
    if (status) query.status = status;
    if (vehicle) query.vehicle = vehicle;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const logs = await Maintenance.find(query)
      .populate('vehicle')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await Maintenance.countDocuments(query);

    res.status(200).json({
      status: 'success',
      data: {
        logs,
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
 * @route   PATCH /api/maintenance/:id
 * @desc    Update log (including closing maintenance, which returns vehicle to Available status)
 */
router.patch(
  '/:id',
  authorize('update', 'Maintenance'),
  validateBody(updateMaintenanceSchema),
  policyGate(MaintenancePolicy, 'canUpdate', loadMaintenance),
  async (req, res, next) => {
    try {
      const oldLog = req.target;
      const { status } = req.body;

      const updatedLog = await executeWithTransaction(async (session) => {
        const options = session ? { session } : {};

        // If closing/completing/cancelling maintenance, restore vehicle to Available
        const isClosingStatus = ['Closed', 'Completed', 'Cancelled'].includes(status);
        if (isClosingStatus && oldLog.status === 'Active') {
          // Set vehicle status to Available, unless the vehicle was retired in the meantime
          const vehicle = await Vehicle.findById(oldLog.vehicle);
          if (vehicle && vehicle.status === 'In Shop') {
            await Vehicle.findByIdAndUpdate(oldLog.vehicle, { status: 'Available' }, options);
          }
          req.body.endDate = new Date();
        }

        return await Maintenance.findByIdAndUpdate(
          req.params.id,
          req.body,
          { new: true, runValidators: true, ...options }
        );
      });

      await writeAuditLog(req, 'UPDATE', 'Maintenance', req.params.id, oldLog, updatedLog);

      res.status(200).json({
        status: 'success',
        message: `Maintenance updated. Status is now ${updatedLog.status}`,
        data: { maintenance: updatedLog },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   DELETE /api/maintenance/:id
 * @desc    Soft delete maintenance log (restores vehicle status if active)
 */
router.delete(
  '/:id',
  authorize('delete', 'Maintenance'),
  policyGate(MaintenancePolicy, 'canDelete', loadMaintenance),
  async (req, res, next) => {
    try {
      const oldLog = req.target;

      await executeWithTransaction(async (session) => {
        const options = session ? { session } : {};

        // If deleted log was active (In Progress), return vehicle to Available
        if (oldLog.status === 'In Progress') {
          await Vehicle.findByIdAndUpdate(oldLog.vehicle, { status: 'Available' }, options);
        }

        await Maintenance.findByIdAndUpdate(req.params.id, { isDeleted: true }, options);
      });

      await writeAuditLog(req, 'DELETE', 'Maintenance', req.params.id, oldLog, { ...oldLog.toJSON(), isDeleted: true });

      res.status(200).json({
        status: 'success',
        message: 'Maintenance record deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
