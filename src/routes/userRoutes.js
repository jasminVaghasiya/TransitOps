import express from 'express';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { protect } from '../middleware/auth.js';
import { attachAbility, authorize, policyGate } from '../middleware/rbac.js';
import { validateBody } from '../middleware/validate.js';
import { userAdminUpdateSchema } from '../validation/transitValidation.js';
import UserPolicy from '../policies/UserPolicy.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = express.Router();

router.use(protect);
router.use(attachAbility);

const loadUser = async (req) => {
  return await User.findById(req.params.id);
};

/**
 * @route   GET /api/users
 * @desc    List all users (Admin only)
 */
router.get('/', authorize('manage', 'User'), async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const users = await User.find()
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await User.countDocuments();

    res.status(200).json({
      status: 'success',
      data: {
        users,
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
 * @route   GET /api/users/audit
 * @desc    List all audit logs (Admin only)
 */
router.get('/audit', authorize('manage', 'User'), async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const logs = await AuditLog.find()
      .populate('user', 'name email role')
      .sort('-timestamp')
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await AuditLog.countDocuments();

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
 * @route   GET /api/users/:id
 * @desc    Get user details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const isSelf = String(req.user._id) === String(req.params.id);
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && !isSelf) {
      return res.status(403).json({
        status: 'fail',
        message: 'You are not authorized to view this user account',
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ status: 'fail', message: 'User not found' });
    }

    res.status(200).json({
      status: 'success',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/users/:id
 * @desc    Update user details (name, email, role, status)
 */
router.patch(
  '/:id',
  validateBody(userAdminUpdateSchema),
  policyGate(UserPolicy, 'canUpdate', loadUser),
  async (req, res, next) => {
    try {
      const oldUser = req.target;

      const updatedUser = await User.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      );

      await writeAuditLog(req, 'UPDATE', 'User', req.params.id, oldUser, updatedUser);

      res.status(200).json({
        status: 'success',
        message: 'User account updated successfully',
        data: { user: updatedUser },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   DELETE /api/users/:id
 * @desc    Hard delete user account (Admin only)
 */
router.delete(
  '/:id',
  policyGate(UserPolicy, 'canDelete', loadUser),
  async (req, res, next) => {
    try {
      const oldUser = req.target;

      await User.findByIdAndDelete(req.params.id);

      await writeAuditLog(req, 'DELETE', 'User', req.params.id, oldUser, null);

      res.status(200).json({
        status: 'success',
        message: 'User account deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
