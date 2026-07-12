export default class BasePolicy {
  /**
   * Helper: Check if user is administrator
   */
  isAdmin(actor) {
    return actor?.role === 'admin';
  }

  /**
   * Helper: Check if actor and target ID are identical
   */
  isSameUser(actor, target) {
    if (!actor?._id || !target?._id) return false;
    return String(actor._id) === String(target._id);
  }

  /**
   * Helper: Null/Undefined safe ID comparison
   */
  isEqualIds(idA, idB) {
    if (!idA || !idB) return false;
    return String(idA) === String(idB);
  }

  /**
   * Default deny return object
   */
  deny(reason = 'Operation denied by security policy', code = 'ROLE_DENIED') {
    return { allowed: false, reason, code };
  }

  /**
   * Approve return object
   */
  allow() {
    return { allowed: true };
  }
}
