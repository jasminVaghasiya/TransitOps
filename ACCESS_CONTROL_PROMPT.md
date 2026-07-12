# Production-Ready Authorization & Policy Generator Prompt

Use the prompt below in a fresh conversation with any advanced LLM (Gemini 3.5, Claude 3.5 Sonnet, GPT-4o) to generate robust, production-ready, bug-free access control policies and middleware for your application. It follows the **Dual-Layer Coarse/Fine Authorization Pattern** (combining declarative role/field checks like CASL with fine-grained imperative policy classes).

***

```markdown
You are a Principal Security Architect and Senior Software Engineer specializing in authorization patterns, API security, and access control (RBAC/ABAC). 

Your task is to write a production-ready, bug-free, and highly secure authorization system for a Node.js/Express application. The design must implement a **Dual-Layer Authorization Architecture** as specified below.

---

### 1. The Architectural Pattern

To avoid security bugs and make the authorization system scalable and easy to audit, the system uses two distinct layers:

1. **Coarse-Grained Layer (Declarative - CASL-like)**:
   - Evaluates whether the user's role allows them to perform an action on a resource class/subject (e.g., "Can an Employee delete Tasks?").
   - Restricts field-level access (e.g., "Employees can update their profile, but NOT the 'role' field").
   - Evaluates basic declarative rules (e.g., "Managers can only read projects matching their departmentId").

2. **Fine-Grained Layer (Imperative - Policy Classes)**:
   - Evaluates stateful conditions comparing live data records that declarative engines cannot express cleanly (e.g., "Is the user deleting themselves?", "Does the project contain active tasks?", "Is the task archived?").
   - Inherits from a base `Policy` class providing helper methods.
   - Methods take `(actor, target, ...extras)` and return `{ allowed: boolean, reason?: string, code?: string }`.

---

### 2. Guardrails & Bug Prevention Requirements

When generating the code, you must strictly prevent common authorization vulnerabilities (OWASP Top 10 BOLA/IDOR/Function Level Authorization):

1. **Null/Undefined Safety**: Ensure all properties on `actor` and `target` are checked safely using optional chaining (e.g., `actor?.id`, `target?.departmentId`) to prevent runtime crashes.
2. **Strict Comparisons**: Always use strict equality (`===`) for comparing IDs and roles. Treat IDs as strings (or call `.toString()` on ObjectIds if using MongoDB).
3. **Self-Action Prevention**: Always block actors from performing unauthorized operations on themselves (e.g., self-deletion of an active session) unless explicitly allowed.
4. **Role Hierarchy Enforcement**: Prevent lower roles from modifying, deleting, or escalating roles of higher or equal status (e.g., Admin cannot delete Super Admin, Manager cannot update Admin).
5. **Cross-Boundary Checks**: Enforce tenant/department boundaries. If an actor is scoped to a department/tenant, any access to a resource outside that department/tenant must be blocked.
6. **Stateful Constraints**: Enforce resource state checks (e.g., archived resources are locked for updates; completed items cannot be deleted).
7. **Immutable Field Locks**: Explicitly check the `changes` payload in update policies to block updating restricted fields (e.g., changing role, changing department).
8. **Default Deny**: End every authorization method with a fallback `{ allowed: false, reason: "...", code: "ROLE_DENIED" }` block. Never let a code path silently fall through to approval.

---

### 3. Required Base Structure

Your generated codebase must include:

#### A. Shared types/enums
Define roles, actions, and subjects as frozen constants:
```javascript
const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
});

const ACTIONS = Object.freeze({
  MANAGE: 'manage',
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
});

const SUBJECTS = Object.freeze({
  ALL: 'all',
  USER: 'User',
  PROJECT: 'Project',
  TASK: 'Task',
});
```

#### B. The Base `Policy` Class
Must contain utility helpers to keep subclass code clean:
```javascript
class Policy {
  static isSuperAdmin(actor) {
    return actor?.role === 'super_admin';
  }

  static isAdmin(actor) {
    return actor?.role === 'admin';
  }

  static isSameUser(actor, target) {
    if (!actor?.id || !target?.id) return false;
    return String(actor.id) === String(target.id);
  }

  static sameDepartment(actor, target) {
    if (!actor?.departmentId || !target?.departmentId) return false;
    return String(actor.departmentId) === String(target.departmentId);
  }
}
```

#### C. Subclassed Policies
Subclasses must implement methods for `canCreate`, `canRead`, `canUpdate`, and `canDelete`.
Example response contract:
`return { allowed: false, reason: "...", code: "..." };` or `return { allowed: true };`

#### D. The Middleware Gateways
Provide three key Express middlewares:
1. `attachAbility`: Attaches the declarative abilities map (like CASL) onto `req.ability` based on `req.user`.
2. `authorize(action, subject)`: The coarse gate to check general RBAC/permissions.
3. `policyGate(policy, methodName, loader, options)`: The fine gate that:
   - Uses `loader(req)` to fetch the target record(s).
   - Optionally performs a CASL check against the actual record or fields.
   - Invokes `policy[methodName](req.user, target, ...extraArgs)`.
   - Populates `req.target = target` and calls `next()` or throws a JSON error/calls `next(err)`.

---

### 4. Input Specification

Generate the complete, bug-free, fully production-ready code files for the following application spec:

[INSERT YOUR APPLICATION MODELS, ROLES, AND RULES HERE]

For example:
- **Models**:
  - `User { id, role, departmentId, archived }`
  - `Project { id, departmentId, archived, taskIds[] }`
  - `Task { id, projectId, departmentId, assigneeId, status, archived }`
- **Rules**:
  - Super Admin can manage everything.
  - Admin can update/delete all projects and tasks. Admin cannot delete Super Admin.
  - Manager can manage projects/tasks/users inside their own department. Manager cannot delete projects. Manager cannot change user roles.
  - Employee can only see tasks assigned to them, create tasks for themselves, update tasks assigned to them, and cannot delete tasks. Employee cannot update projects.
  - Completed tasks cannot be deleted by anyone. Archived projects/tasks cannot be updated/deleted by anyone.

Please write the complete code files including the Types, CASL Ability definitions, Base Policy class, Subclassed policies, and Middleware Gates. Ensure zero placeholders and write highly readable, documented, and secure JavaScript/TypeScript.
```
