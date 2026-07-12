import express from 'express';
import {
  signup,
  login,
  refresh,
  logout,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { signupSchema, loginSchema } from '../validation/authValidation.js';

const router = express.Router();

// Apply auth rate limiting and Joi request validation
router.post('/signup', authLimiter, validateBody(signupSchema), signup);
router.post('/login', authLimiter, validateBody(loginSchema), login);

// Token refreshing and logout
router.post('/refresh', refresh);
router.post('/logout', logout);

// Protected testing route (returns current user profile)
router.get('/me', protect, (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      user: req.user,
    },
  });
});

export default router;
