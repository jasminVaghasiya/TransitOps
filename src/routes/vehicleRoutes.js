import express from 'express';
import Vehicle from '../models/Vehicle.js';
import { protect } from '../middleware/auth.js';
import { attachAbility, authorize, policyGate } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { vehicleSchema, updateVehicleSchema } from '../validation/transitValidation.js';
import VehiclePolicy from '../policies/VehiclePolicy.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = express.Router();

// All routes are protected by auth and need ability attachment
router.use(protect);
router.use(attachAbility);

const loadVehicle = async (req) => {
  return await Vehicle.findById(req.params.id);
};

/**
 * @route   POST /api/vehicles
 * @desc    Create a new vehicle
 */
router.post(
  '/',
  authorize('create', 'Vehicle'),
  validateBody(vehicleSchema),
  policyGate(VehiclePolicy, 'canCreate'),
  async (req, res, next) => {
    try {
      const vehicle = await Vehicle.create(req.body);
      
      await writeAuditLog(req, 'CREATE', 'Vehicle', vehicle._id, null, vehicle);

      res.status(201).json({
        status: 'success',
        message: 'Vehicle created successfully',
        data: { vehicle },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/vehicles
 * @desc    List all vehicles (supports filtering, sorting, pagination)
 */
router.get('/', authorize('read', 'Vehicle'), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, sort = '-createdAt', status, search } = req.query;

    const query = { isDeleted: { $ne: true } };

    // Filtering by status
    if (status) {
      query.status = status;
    }

    // Search query on registration number, make, or model
    if (search) {
      query.$or = [
        { registrationNumber: { $regex: search, $options: 'i' } },
        { make: { $regex: search, $options: 'i' } },
        { modelName: { $regex: search, $options: 'i' } },
      ];
    }

    // Pagination
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const vehicles = await Vehicle.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await Vehicle.countDocuments(query);

    res.status(200).json({
      status: 'success',
      data: {
        vehicles,
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
 * @route   GET /api/vehicles/:id
 * @desc    Get vehicle by ID
 */
router.get('/:id', authorize('read', 'Vehicle'), async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ status: 'fail', message: 'Vehicle not found' });
    }

    res.status(200).json({
      status: 'success',
      data: { vehicle },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/vehicles/:id
 * @desc    Update vehicle specifications/status
 */
router.patch(
  '/:id',
  authorize('update', 'Vehicle'),
  validateBody(updateVehicleSchema),
  policyGate(VehiclePolicy, 'canUpdate', loadVehicle),
  async (req, res, next) => {
    try {
      const oldVehicle = req.target;
      
      const updatedVehicle = await Vehicle.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      );

      await writeAuditLog(req, 'UPDATE', 'Vehicle', req.params.id, oldVehicle, updatedVehicle);

      res.status(200).json({
        status: 'success',
        message: 'Vehicle updated successfully',
        data: { vehicle: updatedVehicle },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   DELETE /api/vehicles/:id
 * @desc    Soft delete vehicle
 */
router.delete(
  '/:id',
  authorize('delete', 'Vehicle'),
  policyGate(VehiclePolicy, 'canDelete', loadVehicle),
  async (req, res, next) => {
    try {
      const oldVehicle = req.target;
      
      // Perform soft delete
      const deletedVehicle = await Vehicle.findByIdAndUpdate(
        req.params.id,
        { isDeleted: true },
        { new: true }
      );

      await writeAuditLog(req, 'DELETE', 'Vehicle', req.params.id, oldVehicle, { ...oldVehicle.toJSON(), isDeleted: true });

      res.status(200).json({
        status: 'success',
        message: 'Vehicle deleted successfully (soft delete)',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
