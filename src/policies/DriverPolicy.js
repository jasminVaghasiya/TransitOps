import BasePolicy from './BasePolicy.js';
import Trip from '../models/Trip.js';

export default class DriverPolicy extends BasePolicy {
  async canCreate(actor, target, req) {
    return this.allow();
  }

  async canUpdate(actor, driver, req) {
    const { safetyScore } = req.body;

    // Validate safety score constraints
    if (safetyScore !== undefined && (safetyScore < 0 || safetyScore > 100)) {
      return this.deny('Driver safety score must be between 0 and 100', 'INVALID_SAFETY_SCORE');
    }

    return this.allow();
  }

  async canDelete(actor, driver, req) {
    // Check if trips exist for this driver
    const tripsExist = await Trip.exists({ driver: driver._id });
    if (tripsExist) {
      return this.deny('Driver cannot be deleted because trips exist in their operations history', 'DEPENDENCY_CONSTRAINT');
    }

    return this.allow();
  }
}
