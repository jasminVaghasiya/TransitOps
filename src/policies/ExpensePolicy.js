import BasePolicy from './BasePolicy.js';

export default class ExpensePolicy extends BasePolicy {
  async canCreate(actor, target, req) {
    return this.allow();
  }

  async canUpdate(actor, expense, req) {
    // Cannot edit approved expense unless user is admin
    if (expense.status === 'Approved' && !this.isAdmin(actor)) {
      return this.deny('Approved expenses cannot be modified by non-administrators', 'EXPENSE_APPROVED_LOCKED');
    }

    return this.allow();
  }

  async canDelete(actor, expense, req) {
    // Cannot delete approved expense unless user is admin
    if (expense.status === 'Approved' && !this.isAdmin(actor)) {
      return this.deny('Approved expenses cannot be deleted by non-administrators', 'EXPENSE_APPROVED_LOCKED');
    }

    return this.allow();
  }
}
