import AuditLog from '../models/AuditLog.js';

/**
 * Creates an audit log entry in the database.
 * 
 * @param {Object} req - Express request object (to extract user, IP, and User-Agent)
 * @param {string} action - Action performed (e.g. 'CREATE', 'UPDATE', 'DELETE', 'DISPATCH')
 * @param {string} module - Target module/subject (e.g. 'Vehicle', 'Trip')
 * @param {string} recordId - Identifier of the affected database document
 * @param {Object} [oldValues=null] - Previous state of the document
 * @param {Object} [newValues=null] - New state of the document
 */
export const writeAuditLog = async (req, action, module, recordId, oldValues = null, newValues = null) => {
  try {
    if (!req.user) {
      console.warn(`[AUDIT WARNING] Attempted to log audit trace for action ${action} on ${module} without an authenticated user.`);
      return;
    }

    // Convert Mongoose documents or nested parameters to plain JS objects
    const cleanOld = oldValues && typeof oldValues.toJSON === 'function' ? oldValues.toJSON() : oldValues;
    const cleanNew = newValues && typeof newValues.toJSON === 'function' ? newValues.toJSON() : newValues;

    // Filter out highly sensitive fields (like passwords, keys, etc.)
    if (cleanOld) {
      delete cleanOld.password;
      delete cleanOld.__v;
    }
    if (cleanNew) {
      delete cleanNew.password;
      delete cleanNew.__v;
    }

    await AuditLog.create({
      user: req.user._id,
      action,
      module,
      recordId: String(recordId),
      oldValues: cleanOld,
      newValues: cleanNew,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
  } catch (error) {
    // Fail silently in terms of HTTP response, but log to server console to prevent halting operations
    console.error(`[AUDIT LOG ERROR] Failed to record audit log: ${error.message}`);
  }
};
