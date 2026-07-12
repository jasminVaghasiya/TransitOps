import express from 'express';
import Expense from '../models/Expense.js';
import FuelLog from '../models/FuelLog.js';
import Vehicle from '../models/Vehicle.js';
import { protect } from '../middleware/auth.js';
import { attachAbility, authorize, policyGate } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { expenseSchema, fuelLogSchema, updateExpenseSchema } from '../validation/transitValidation.js';
import ExpensePolicy from '../policies/ExpensePolicy.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = express.Router();

router.use(protect);
router.use(attachAbility);

const loadExpense = async (req) => {
  return await Expense.findById(req.params.id);
};

// ==========================================
// EXPENSE ENDPOINTS
// ==========================================

/**
 * @route   POST /api/expenses
 * @desc    Create a new expense record
 */
router.post(
  '/',
  authorize('create', 'Expense'),
  validateBody(expenseSchema),
  async (req, res, next) => {
    try {
      const expense = await Expense.create(req.body);

      await writeAuditLog(req, 'CREATE', 'Expense', expense._id, null, expense);

      res.status(201).json({
        status: 'success',
        data: { expense },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/expenses
 * @desc    List all expenses (supports filtering and pagination)
 */
router.get('/', authorize('read', 'Expense'), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, sort = '-date', status, vehicle } = req.query;

    const query = { isDeleted: { $ne: true } };
    if (status) query.status = status;
    if (vehicle) query.vehicle = vehicle;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const expenses = await Expense.find(query)
      .populate('vehicle')
      .populate('trip')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await Expense.countDocuments(query);

    res.status(200).json({
      status: 'success',
      data: {
        expenses,
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
 * @route   PATCH /api/expenses/:id
 * @desc    Update expense (approved logs are locked from non-admins)
 */
router.patch(
  '/:id',
  authorize('update', 'Expense'),
  validateBody(updateExpenseSchema),
  policyGate(ExpensePolicy, 'canUpdate', loadExpense),
  async (req, res, next) => {
    try {
      const oldExpense = req.target;

      const updatedExpense = await Expense.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      );

      await writeAuditLog(req, 'UPDATE', 'Expense', req.params.id, oldExpense, updatedExpense);

      res.status(200).json({
        status: 'success',
        data: { expense: updatedExpense },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   DELETE /api/expenses/:id
 * @desc    Soft delete expense
 */
router.delete(
  '/:id',
  authorize('delete', 'Expense'),
  policyGate(ExpensePolicy, 'canDelete', loadExpense),
  async (req, res, next) => {
    try {
      const oldExpense = req.target;

      await Expense.findByIdAndUpdate(req.params.id, { isDeleted: true });

      await writeAuditLog(req, 'DELETE', 'Expense', req.params.id, oldExpense, { ...oldExpense.toJSON(), isDeleted: true });

      res.status(200).json({
        status: 'success',
        message: 'Expense record deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// FUEL LOG ENDPOINTS
// ==========================================

/**
 * @route   POST /api/expenses/fuel
 * @desc    Create a new fuel log
 */
router.post(
  '/fuel',
  authorize('create', 'FuelLog'),
  validateBody(fuelLogSchema),
  async (req, res, next) => {
    try {
      const { vehicle: vehicleId, odometer, date } = req.body;

      // 1. Verify vehicle exists and is not retired
      const vehicle = await Vehicle.findById(vehicleId);
      if (!vehicle) {
        return res.status(404).json({ status: 'fail', message: 'Vehicle not found' });
      }
      if (vehicle.status === 'Retired') {
        return res.status(400).json({
          status: 'fail',
          message: 'Cannot record fuel logs for a retired vehicle',
        });
      }

      // 2. Validate Odometer reading (must not decrease)
      const latestLog = await FuelLog.findOne({ vehicle: vehicleId }).sort('-date -createdAt');
      if (latestLog && odometer < latestLog.odometer) {
        return res.status(400).json({
          status: 'fail',
          message: `Odometer reading (${odometer}) cannot be lower than the vehicle's last recorded odometer (${latestLog.odometer})`,
        });
      }

      // 3. Create fuel log
      const fuelLog = await FuelLog.create(req.body);

      await writeAuditLog(req, 'CREATE', 'FuelLog', fuelLog._id, null, fuelLog);

      res.status(201).json({
        status: 'success',
        data: { fuelLog },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/expenses/fuel
 * @desc    List all fuel logs
 */
router.get('/fuel', authorize('read', 'FuelLog'), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, sort = '-date', vehicle } = req.query;

    const query = { isDeleted: { $ne: true } };
    if (vehicle) query.vehicle = vehicle;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const logs = await FuelLog.find(query)
      .populate('vehicle')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await FuelLog.countDocuments(query);

    res.status(200).json({
      status: 'success',
      data: {
        fuelLogs: logs,
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

export default router;
