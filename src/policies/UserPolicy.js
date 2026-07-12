import BasePolicy from './BasePolicy.js';

export default class UserPolicy extends BasePolicy {
  /**
   * Only administrator can create users
   */
  async canCreate(actor, target, req) {
    if (!this.isAdmin(actor)) {
      return this.deny('Only administrators can create users', 'INSUFFICIENT_PRIVILEGES');
    }

    // Prevent non-super-admins or managers from creating high-role accounts
    const targetRole = req.body?.role;
    if (targetRole === 'admin' && actor.role !== 'admin') {
      return this.deny('You cannot create a user with a higher privilege than yourself', 'ROLE_ELEVATION');
    }

    return this.allow();
  }

  /**
   * Restrict updates on critical parameters
   */
  async canUpdate(actor, target, req) {
    // Only administrator can update users, except users updating basic fields on themselves (like name)
    const isSelf = this.isSameUser(actor, target);
    
    if (!this.isAdmin(actor) && !isSelf) {
      return this.deny('You are not authorized to edit this user', 'INSUFFICIENT_PRIVILEGES');
    }

    // If self-update, prevent self-sabotage
    if (isSelf) {
      // 1. Prevent deactivating self
      if (req.body?.isActive === false) {
        return this.deny('You cannot deactivate your own account', 'SELF_DEACTIVATION_DENIED');
      }

      // 2. Prevent stripping own admin role
      if (actor.role === 'admin' && req.body?.role && req.body.role !== 'admin') {
        return this.deny('You cannot remove the administrator role from yourself', 'SELF_ROLE_DOWNGRADE_DENIED');
      }
    }

    // Prevent non-admins from assigning role
    if (!this.isAdmin(actor) && req.body?.role) {
      return this.deny('Only administrators can modify roles', 'INSUFFICIENT_PRIVILEGES');
    }

    return this.allow();
  }

  /**
   * Prevent self deletion
   */
  async canDelete(actor, target, req) {
    if (!this.isAdmin(actor)) {
      return this.deny('Only administrators can delete users', 'INSUFFICIENT_PRIVILEGES');
    }

    if (this.isSameUser(actor, target)) {
      return this.deny('You cannot delete your own user account', 'SELF_DELETION_DENIED');
    }

    return this.allow();
  }
}
