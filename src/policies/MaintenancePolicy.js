import BasePolicy from './BasePolicy.js';
import Vehicle from '../models/Vehicle.js';
import Maintenance from '../models/Maintenance.js';

export default class MaintenancePolicy extends BasePolicy {
  /**
   * Validate if a maintenance record can be created for a vehicle
   */
  async canCreate(actor, target, req) {
    const { vehicle: vehicleId } = req.body;

    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) {
      return this.deny('Vehicle not found', 'VEHICLE_NOT_FOUND');
    }

    // Vehicle must be available to enter shop
    if (vehicle.status !== 'Available') {
      return this.deny(`Vehicle cannot enter maintenance while in status '${vehicle.status}'`, 'VEHICLE_UNAVAILABLE');
    }

    // Vehicle cannot have an active maintenance log already
    const activeMaintenanceExists = await Maintenance.exists({
      vehicle: vehicleId,
      status: 'In Progress',
    });

    if (activeMaintenanceExists) {
      return this.deny('Vehicle is already in active maintenance', 'DUPLICATE_MAINTENANCE');
    }

    return this.allow();
  }

  /**
   * Restricts maintenance modifications
   */
  async canUpdate(actor, maintenance, req) {
    const { status } = req.body;

    if (maintenance.status === 'Completed' && status !== 'Completed') {
      return this.deny('Completed maintenance logs are immutable', 'MAINTENANCE_LOCKED');
    }

    return this.allow();
  }

  /**
   * Active maintenance logs can be deleted, closed ones require admin permission
   */
  async canDelete(actor, maintenance, req) {
    if (maintenance.status === 'Completed' && !this.isAdmin(actor)) {
      return this.deny('Only administrators can delete completed maintenance logs', 'MAINTENANCE_LOCKED');
    }
    return this.allow();
  }
}
