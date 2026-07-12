import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';

// Helper to parse expiry string (e.g. '7d', '15m') into milliseconds
const parseExpiryToMs = (expiryString) => {
  const match = expiryString.match(/^(\d+)([dhm])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
};

// Helper to generate access tokens
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '15m' }
  );
};

// Helper to generate and save a refresh token in the database
const createAndPersistRefreshToken = async (user, req) => {
  const tokenString = crypto.randomBytes(40).toString('hex');
  const expiryDuration = parseExpiryToMs(process.env.REFRESH_TOKEN_EXPIRY || '7d');
  const expiresAt = new Date(Date.now() + expiryDuration);

  // Save the refresh token in the database
  const refreshToken = await RefreshToken.create({
    token: tokenString,
    user: user._id,
    expiresAt,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return refreshToken;
};

// Helper to configure the refresh token cookie
const sendRefreshTokenCookie = (res, tokenString) => {
  const expiryDuration = parseExpiryToMs(process.env.REFRESH_TOKEN_EXPIRY || '7d');
  
  const cookieOptions = {
    httpOnly: true, // Protects against XSS attacks
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production', // true in production (HTTPS)
    sameSite: 'strict', // Protects against CSRF
    maxAge: expiryDuration,
  };

  res.cookie('refreshToken', tokenString, cookieOptions);
};

/**
 * @desc    Register a new user
 * @route   POST /api/auth/signup
 * @access  Public
 */
export const signup = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    // 1. Check if user already exists
    const emailExists = await User.findOne({ email });
    if (emailExists) {
      return res.status(400).json({
        status: 'fail',
        message: 'Email is already registered',
      });
    }

    // 2. Create the user
    // Restrict role assignment unless authorized, or let it default to 'user'
    const newUser = await User.create({
      name,
      email,
      password,
      role: role && ['user', 'admin'].includes(role) ? role : 'user',
    });

    // 4. Generate tokens
    const accessToken = generateAccessToken(newUser);
    const refreshToken = await createAndPersistRefreshToken(newUser, req);

    // 5. Send cookie & response
    sendRefreshTokenCookie(res, refreshToken.token);

    res.status(201).json({
      status: 'success',
      data: {
        user: newUser,
        accessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Login user & create tokens
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. Check if user exists (explicitly select password and lockout fields)
    const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil +isActive');
    
    if (!user) {
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid email or password',
      });
    }

    // 2. Check if user account is active
    if (!user.isActive) {
      return res.status(403).json({
        status: 'fail',
        message: 'Your account has been deactivated. Please contact an administrator.',
      });
    }

    // 3. Check if user account is locked
    if (user.isLocked) {
      const remainingTime = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(403).json({
        status: 'fail',
        message: `Your account is temporarily locked due to repeated failed login attempts. Try again in ${remainingTime} minutes.`,
      });
    }

    // 4. Match password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      // Increment failed attempts
      user.loginAttempts += 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 60 * 60 * 1000); // Lock for 1 hour
        console.warn(`[SECURITY WARNING] Account locked for user: ${user.email} due to 5 failed attempts.`);
      }
      await user.save();

      return res.status(401).json({
        status: 'fail',
        message: 'Invalid email or password',
      });
    }

    // 5. Success - Reset lockout fields
    if (user.loginAttempts > 0 || user.lockUntil) {
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }

    // 6. Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = await createAndPersistRefreshToken(user, req);

    // 7. Send cookie & response
    sendRefreshTokenCookie(res, refreshToken.token);

    res.status(200).json({
      status: 'success',
      data: {
        user,
        accessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Refresh access and refresh tokens (Refresh Token Rotation - RTR)
 * @route   POST /api/auth/refresh
 * @access  Public
 */
export const refresh = async (req, res, next) => {
  try {
    const { refreshToken: cookieToken } = req.cookies;

    if (!cookieToken) {
      return res.status(401).json({
        status: 'fail',
        message: 'Refresh token is missing',
      });
    }

    // Find the refresh token in DB
    const storedToken = await RefreshToken.findOne({ token: cookieToken }).populate('user');

    // --- RTR SECURITY check: Detect Token Reuse ---
    if (!storedToken) {
      // If token is not found in the DB but is present in the cookie,
      // it might be a malicious reuse. However, since we cannot locate it,
      // we can't trace the user. We simply clear cookie and return 401.
      res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'strict' });
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid refresh token',
      });
    }

    // If the token has been revoked, it indicates REUSE (e.g. token theft).
    if (storedToken.revokedAt) {
      console.warn(`[SECURITY WARNING] Reused refresh token detected for user: ${storedToken.user._id}. Revoking all active sessions.`);
      
      // Revoke all tokens belonging to this user immediately
      await RefreshToken.updateMany(
        { user: storedToken.user._id, revokedAt: { $exists: false } },
        { revokedAt: new Date() }
      );

      res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'strict' });
      return res.status(403).json({
        status: 'fail',
        message: 'Compromised credentials detected. Please login again.',
      });
    }

    // If token is expired
    if (storedToken.expiresAt < new Date()) {
      // Mark it revoked (expired)
      storedToken.revokedAt = new Date();
      await storedToken.save();
      res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'strict' });
      return res.status(401).json({
        status: 'fail',
        message: 'Refresh token has expired',
      });
    }

    // --- NORMAL RTR ROTATION ---
    const user = storedToken.user;
    
    // Generate new Access and Refresh tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = await createAndPersistRefreshToken(user, req);

    // Invalidate the old token
    storedToken.revokedAt = new Date();
    storedToken.replacedByToken = newRefreshToken.token;
    await storedToken.save();

    // Send new refresh token in cookie
    sendRefreshTokenCookie(res, newRefreshToken.token);

    res.status(200).json({
      status: 'success',
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Logout user & revoke current refresh token
 * @route   POST /api/auth/logout
 * @access  Public (or Protected)
 */
export const logout = async (req, res, next) => {
  try {
    const { refreshToken: cookieToken } = req.cookies;

    if (cookieToken) {
      // Mark the refresh token as revoked in the database
      await RefreshToken.findOneAndUpdate(
        { token: cookieToken },
        { revokedAt: new Date() }
      );
    }

    // Clear client-side cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};
