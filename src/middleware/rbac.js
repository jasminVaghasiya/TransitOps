export const ROLES = Object.freeze({
  FLEET_MANAGER: 'fleet_manager',
  DRIVER: 'driver',
  SAFETY_OFFICER: 'safety_officer',
  FINANCIAL_ANALYST: 'financial_analyst',
});

export const ACTIONS = Object.freeze({
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  CANCEL: 'cancel',
  EXPORT: 'export',
  PRINT: 'print',
  ASSIGN: 'assign',
  CLOSE: 'close',
  RESTORE: 'restore',
  ARCHIVE: 'archive',
  RETIRE: 'retire',
  VALIDATE: 'validate',
  SCORE: 'score',
  MANAGE: 'manage',
});

export const SUBJECTS = Object.freeze({
  ALL: 'all',
  USER: 'User',
  VEHICLE: 'Vehicle',
  DRIVER: 'Driver',
  TRIP: 'Trip',
  MAINTENANCE: 'Maintenance',
  FUEL_LOG: 'FuelLog',
  EXPENSE: 'Expense',
  AUDIT_LOG: 'AuditLog',
  REPORT: 'Report',
  DASHBOARD: 'Dashboard',
});

// Declarative RBAC rules
const ROLE_ABILITIES = {
  [ROLES.FLEET_MANAGER]: {
    [ACTIONS.READ]: [SUBJECTS.ALL],
    [ACTIONS.CREATE]: [SUBJECTS.VEHICLE, SUBJECTS.TRIP, SUBJECTS.EXPENSE, SUBJECTS.FUEL_LOG, SUBJECTS.MAINTENANCE],
    [ACTIONS.UPDATE]: [SUBJECTS.VEHICLE, SUBJECTS.TRIP, SUBJECTS.EXPENSE, SUBJECTS.FUEL_LOG, SUBJECTS.MAINTENANCE],
    [ACTIONS.DELETE]: [SUBJECTS.VEHICLE, SUBJECTS.TRIP, SUBJECTS.EXPENSE, SUBJECTS.FUEL_LOG, SUBJECTS.MAINTENANCE],
  },
  [ROLES.DRIVER]: {
    [ACTIONS.READ]: [SUBJECTS.VEHICLE, SUBJECTS.DRIVER, SUBJECTS.TRIP, SUBJECTS.MAINTENANCE, SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE, SUBJECTS.REPORT, SUBJECTS.DASHBOARD],
    [ACTIONS.CREATE]: [SUBJECTS.TRIP, SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE, SUBJECTS.DRIVER],
    [ACTIONS.UPDATE]: [SUBJECTS.TRIP, SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE],
    [ACTIONS.DELETE]: [SUBJECTS.TRIP, SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE],
    [ACTIONS.ASSIGN]: [SUBJECTS.VEHICLE, SUBJECTS.DRIVER],
    [ACTIONS.CANCEL]: [SUBJECTS.TRIP],
    [ACTIONS.EXPORT]: [SUBJECTS.REPORT],
  },
  [ROLES.SAFETY_OFFICER]: {
    [ACTIONS.READ]: [SUBJECTS.VEHICLE, SUBJECTS.DRIVER, SUBJECTS.TRIP, SUBJECTS.MAINTENANCE, SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE, SUBJECTS.REPORT, SUBJECTS.DASHBOARD],
    [ACTIONS.CREATE]: [SUBJECTS.DRIVER],
    [ACTIONS.UPDATE]: [SUBJECTS.DRIVER],
    [ACTIONS.DELETE]: [SUBJECTS.DRIVER],
    [ACTIONS.VALIDATE]: [SUBJECTS.DRIVER],
    [ACTIONS.SCORE]: [SUBJECTS.DRIVER],
  },
  [ROLES.FINANCIAL_ANALYST]: {
    [ACTIONS.READ]: [SUBJECTS.VEHICLE, SUBJECTS.DRIVER, SUBJECTS.TRIP, SUBJECTS.MAINTENANCE, SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE, SUBJECTS.REPORT, SUBJECTS.DASHBOARD],
    [ACTIONS.CREATE]: [SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE],
    [ACTIONS.UPDATE]: [SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE],
    [ACTIONS.DELETE]: [SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE],
    [ACTIONS.APPROVE]: [SUBJECTS.EXPENSE],
    [ACTIONS.CANCEL]: [SUBJECTS.EXPENSE],
    [ACTIONS.EXPORT]: [SUBJECTS.FUEL_LOG, SUBJECTS.EXPENSE, SUBJECTS.REPORT],
  },
};

/**
 * Checks if a user has a declarative permission
 */
const hasDeclarativePermission = (userRole, action, subject) => {
  const abilities = ROLE_ABILITIES[userRole];
  if (!abilities) return false;

  // Admin check
  if (abilities[ACTIONS.MANAGE] && abilities[ACTIONS.MANAGE].includes(SUBJECTS.ALL)) {
    return true;
  }

  // Action check
  const subjectsForAction = abilities[action];
  if (subjectsForAction && (subjectsForAction.includes(subject) || subjectsForAction.includes(SUBJECTS.ALL))) {
    return true;
  }

  // Manage check for specific subject
  const manageSubjects = abilities[ACTIONS.MANAGE];
  if (manageSubjects && (manageSubjects.includes(subject) || manageSubjects.includes(SUBJECTS.ALL))) {
    return true;
  }

  // If action is read/view and role has read all
  if (action === ACTIONS.READ && abilities[ACTIONS.READ] && abilities[ACTIONS.READ].includes(SUBJECTS.ALL)) {
    return true;
  }

  return false;
};

/**
 * Middleware: Attaches the declarative abilities check function to req
 */
export const attachAbility = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ status: 'fail', message: 'Not authenticated' });
  }

  req.ability = {
    can: (action, subject) => hasDeclarativePermission(req.user.role, action, subject),
  };

  next();
};

/**
 * Middleware: Coarse-grained RBAC check
 */
export const authorize = (action, subject) => {
  return (req, res, next) => {
    if (!req.ability) {
      return res.status(500).json({ status: 'error', message: 'Ability context missing' });
    }

    if (!req.ability.can(action, subject)) {
      return res.status(403).json({
        status: 'fail',
        message: `You do not have permission to perform '${action}' on '${subject}'`,
      });
    }

    next();
  };
};

/**
 * Middleware: Fine-grained Policy Gate
 * Loads target record, performs coarse check, runs imperative policy checks.
 *
 * @param {Class} PolicyClass - The Policy class to instantiate
 * @param {string} methodName - The policy method to run (e.g. 'canUpdate')
 * @param {function} loader - Async function taking (req) and returning the database record
 */
export const policyGate = (PolicyClass, methodName, loader = null) => {
  return async (req, res, next) => {
    try {
      let target = null;

      // 1. Resolve target resource using the loader helper
      if (loader) {
        target = await loader(req);
        if (!target) {
          return res.status(404).json({
            status: 'fail',
            message: 'Resource not found',
          });
        }
        req.target = target;
      }

      // 2. Instantiate and evaluate policy
      const policy = new PolicyClass();
      const policyResult = await policy[methodName](req.user, target, req);

      if (!policyResult.allowed) {
        return res.status(403).json({
          status: 'fail',
          message: policyResult.reason || 'Operation denied by security policy',
          code: policyResult.code || 'POLICY_VIOLATION',
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
