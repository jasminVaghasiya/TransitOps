import express from 'express';
import Driver from '../models/Driver.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { attachAbility, authorize, policyGate } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { driverSchema, updateDriverSchema } from '../validation/transitValidation.js';
import DriverPolicy from '../policies/DriverPolicy.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = express.Router();

router.use(protect);
router.use(attachAbility);

const autoCheckLeaves = async (req, res, next) => {
  try {
    await Driver.updateMany(
      { status: 'On Leave', leaveUntil: { $lt: new Date() } },
      { status: 'Available', $unset: { leaveUntil: "" } }
    );
    next();
  } catch (error) {
    next(error);
  }
};

router.use(autoCheckLeaves);

const loadDriver = async (req) => {
  return await Driver.findById(req.params.id);
};

/**
 * @route   POST /api/drivers
 * @desc    Create a new driver
 */
router.post(
  '/',
  authorize('create', 'Driver'),
  validateBody(driverSchema),
  policyGate(DriverPolicy, 'canCreate'),
  async (req, res, next) => {
    try {
      const driver = await Driver.create(req.body);
      
      await writeAuditLog(req, 'CREATE', 'Driver', driver._id, null, driver);

      res.status(201).json({
        status: 'success',
        message: 'Driver created successfully',
        data: { driver },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/drivers
 * @desc    List all drivers (supports filtering, sorting, pagination)
 */
router.get('/', authorize('read', 'Driver'), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, sort = '-createdAt', status, search } = req.query;

    const query = { isDeleted: { $ne: true } };

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { licenseNumber: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const drivers = await Driver.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await Driver.countDocuments(query);

    res.status(200).json({
      status: 'success',
      data: {
        drivers,
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
 * @route   GET /api/drivers/:id
 * @desc    Get driver by ID
 */
router.get('/:id', authorize('read', 'Driver'), async (req, res, next) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ status: 'fail', message: 'Driver not found' });
    }

    res.status(200).json({
      status: 'success',
      data: { driver },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/drivers/:id
 * @desc    Update driver profile details
 */
router.patch(
  '/:id',
  authorize('update', 'Driver'),
  validateBody(updateDriverSchema),
  policyGate(DriverPolicy, 'canUpdate', loadDriver),
  async (req, res, next) => {
    try {
      const oldDriver = req.target;
      
      const updatedDriver = await Driver.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      );

      await writeAuditLog(req, 'UPDATE', 'Driver', req.params.id, oldDriver, updatedDriver);

      res.status(200).json({
        status: 'success',
        message: 'Driver profile updated successfully',
        data: { driver: updatedDriver },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   DELETE /api/drivers/:id
 * @desc    Soft delete driver
 */
router.delete(
  '/:id',
  authorize('delete', 'Driver'),
  policyGate(DriverPolicy, 'canDelete', loadDriver),
  async (req, res, next) => {
    try {
      const oldDriver = req.target;

      await Driver.findByIdAndUpdate(req.params.id, { isDeleted: true });

      await writeAuditLog(req, 'DELETE', 'Driver', req.params.id, oldDriver, { ...oldDriver.toJSON(), isDeleted: true });

      res.status(200).json({
        status: 'success',
        message: 'Driver deleted successfully (soft delete)',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/drivers/:id/complaints
 * @desc    File a complaint against a driver (accessible to any authenticated role)
 */
router.post('/:id/complaints', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ status: 'fail', message: 'Complaint text is required' });
    }

    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ status: 'fail', message: 'Driver not found' });
    }

    driver.complaints.push({
      text,
      submittedBy: req.user.name || req.user.role,
      createdAt: new Date(),
    });

    await driver.save();

    res.status(200).json({
      status: 'success',
      message: 'Complaint filed successfully',
      data: { driver },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/drivers/:id/complaints/:complaintId
 * @desc    Resolve or Reject a driver complaint (Safety Officer or Fleet Manager)
 */
router.patch('/:id/complaints/:complaintId', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['Resolved', 'Rejected'].includes(status)) {
      return res.status(400).json({ status: 'fail', message: 'Invalid complaint status' });
    }

    if (req.user.role !== 'safety_officer' && req.user.role !== 'fleet_manager') {
      return res.status(403).json({ status: 'fail', message: 'Only Safety Officers or Fleet Managers can resolve/reject complaints' });
    }

    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ status: 'fail', message: 'Driver not found' });
    }

    const complaint = driver.complaints.id(req.params.complaintId);
    if (!complaint) {
      return res.status(404).json({ status: 'fail', message: 'Complaint not found' });
    }

    complaint.status = status;
    await driver.save();

    res.status(200).json({
      status: 'success',
      message: `Complaint marked as ${status} successfully`,
      data: { driver },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
