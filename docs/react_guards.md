# TransitOps React Route Guards & UI Permission Integration

To ensure the React frontend matches the backend's access control policies, implement this client-side authorization architecture. 

*Note: Frontend visibility controls are for user experience. The Express backend always validates permissions for every API invocation.*

---

## 1. Authentication Context (`AuthContext.jsx`)

Create a standard Auth Context to store the user details and the JWT Access Token in-memory.

```jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Silent refresh token routine on app load
  useEffect(() => {
    const silentRefresh = async () => {
      try {
        const response = await axios.post('/api/auth/refresh', {}, { withCredentials: true });
        setAccessToken(response.data.data.accessToken);
        
        // Fetch current user details
        const userResponse = await axios.get('/api/auth/me', {
          headers: { Authorization: `Bearer ${response.data.data.accessToken}` }
        });
        setUser(userResponse.data.data.user);
      } catch (err) {
        console.warn('No active session found.');
      } finally {
        setLoading(false);
      }
    };
    silentRefresh();
  }, []);

  const login = async (email, password) => {
    const response = await axios.post('/api/auth/login', { email, password }, { withCredentials: true });
    setAccessToken(response.data.data.accessToken);
    setUser(response.data.data.user);
    return response.data.data.user;
  };

  const logout = async () => {
    await axios.post('/api/auth/logout', {}, { withCredentials: true });
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, accessToken, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
```

---

## 2. Declarative RBAC Check Hook (`useAbility.js`)

Mirroring the backend's declarative abilities, this hook lets you verify if a user's role allows a specific action on a module.

```javascript
import { useAuth } from './AuthContext';

// Client-side copy of the RBAC ability map
const ROLE_ABILITIES = {
  admin: {
    manage: ['all'],
  },
  fleet_manager: {
    create: ['Vehicle', 'Maintenance'],
    read: ['Vehicle', 'Maintenance', 'Driver', 'Trip', 'FuelLog', 'Expense', 'Report', 'Dashboard'],
    update: ['Vehicle', 'Maintenance'],
    delete: ['Vehicle', 'Maintenance'],
    retire: ['Vehicle'],
    assign: ['Vehicle'],
    close: ['Maintenance'],
    export: ['Report'],
  },
  dispatcher: {
    create: ['Trip'],
    read: ['Vehicle', 'Driver', 'Trip', 'Maintenance', 'FuelLog', 'Expense', 'Report', 'Dashboard'],
    update: ['Trip'],
    delete: ['Trip'],
    dispatch: ['Trip'],
    complete: ['Trip'],
    cancel: ['Trip'],
    assign: ['Vehicle', 'Driver'],
    export: ['Report'],
  },
  safety_officer: {
    create: ['Driver'],
    read: ['Vehicle', 'Driver', 'Trip', 'Maintenance', 'FuelLog', 'Expense', 'Report', 'Dashboard'],
    update: ['Driver'],
    delete: ['Driver'],
    validate: ['Driver'],
    score: ['Driver'],
  },
  financial_analyst: {
    create: ['FuelLog', 'Expense'],
    read: ['Vehicle', 'Driver', 'Trip', 'Maintenance', 'FuelLog', 'Expense', 'Report', 'Dashboard'],
    update: ['FuelLog', 'Expense'],
    delete: ['FuelLog', 'Expense'],
    approve: ['Expense'],
    cancel: ['Expense'],
    export: ['FuelLog', 'Expense', 'Report'],
  },
  read_only: {
    read: ['all'],
  },
};

export const useAbility = () => {
  const { user } = useAuth();

  const can = (action, subject) => {
    if (!user || !user.role) return false;
    const abilities = ROLE_ABILITIES[user.role];
    if (!abilities) return false;

    // Admin override
    if (abilities['manage'] && abilities['manage'].includes('all')) {
      return true;
    }

    // Action check
    const subjectsForAction = abilities[action];
    if (subjectsForAction && (subjectsForAction.includes(subject) || subjectsForAction.includes('all'))) {
      return true;
    }

    // Manage check for specific subject
    const manageSubjects = abilities['manage'];
    if (manageSubjects && (manageSubjects.includes(subject) || manageSubjects.includes('all'))) {
      return true;
    }

    // View all check
    if (action === 'read' && abilities['read'] && abilities['read'].includes('all')) {
      return true;
    }

    return false;
  };

  return { can };
};
```

---

## 3. React Route Guard Component (`ProtectedRoute.jsx`)

Protects React Router pages. Block access to routes if the user is unauthenticated or has insufficient permissions.

```jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useAbility } from './useAbility';

/**
 * Route guard restricting access by authentication and RBAC permissions.
 * 
 * @param {string} [action] - Coarse action required (e.g. 'read', 'create')
 * @param {string} [subject] - Target module (e.g. 'Vehicle', 'Trip')
 */
export const ProtectedRoute = ({ children, action, subject }) => {
  const { user, loading } = useAuth();
  const { can } = useAbility();
  const location = useLocation();

  if (loading) {
    return <div className="spinner">Loading session...</div>;
  }

  // 1. Authentication check
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 2. Authorization check (if action/subject specified)
  if (action && subject && !can(action, subject)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};
```

---

## 4. UI Visibility Wrapper Component (`Authorize.jsx`)

Use this component to conditionally render parts of a page (e.g., hiding a "Delete Vehicle" button for financial analysts).

```jsx
import React from 'react';
import { useAbility } from './useAbility';

/**
 * Conditionally renders children if user role passes the authorization check.
 * 
 * @param {string} action - Required permission action
 * @param {string} subject - Target module/subject
 * @param {React.ReactNode} [fallback=null] - Component to show if denied
 */
export const Authorize = ({ action, subject, children, fallback = null }) => {
  const { can } = useAbility();

  if (!can(action, subject)) {
    return fallback;
  }

  return <>{children}</>;
};
```

### Usage Example:
```jsx
import { Authorize } from './Authorize';

const VehicleCard = ({ vehicle }) => {
  return (
    <div className="card">
      <h3>{vehicle.registrationNumber}</h3>
      <p>{vehicle.make} - {vehicle.modelName}</p>
      
      <div className="card-actions">
        {/* All roles with view permissions can see details */}
        <Authorize action="read" subject="Vehicle">
          <button>View Details</button>
        </Authorize>

        {/* Only Fleet Managers and Admins can see the edit button */}
        <Authorize action="update" subject="Vehicle">
          <button>Edit Vehicle</button>
        </Authorize>
      </div>
    </div>
  );
};
```
