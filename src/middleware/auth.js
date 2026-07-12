import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * Middleware to authenticate requests using JWT Access Tokens.
 */
export const protect = async (req, res, next) => {
  let token;

  // 1. Check for token in Authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  // 2. Return error if token is not found
  if (!token) {
    return res.status(401).json({
      status: 'fail',
      message: 'Not authorized, token missing',
    });
  }

  try {
    // 3. Verify access token
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // 4. Check if user still exists in database
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        status: 'fail',
        message: 'The user belonging to this token no longer exists.',
      });
    }

    // 5. Grant access and attach user to request object
    req.user = currentUser;
    next();
  } catch (error) {
    let message = 'Not authorized, token invalid';
    if (error.name === 'TokenExpiredError') {
      message = 'Access token expired';
    }

    return res.status(401).json({
      status: 'fail',
      message,
    });
  }
};

/**
 * Middleware to restrict access based on user roles.
 * @param {...string} roles - List of allowed roles
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    // Check if user role is included in the allowed roles
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'fail',
        message: 'You do not have permission to perform this action',
      });
    }
    next();
  };
};
