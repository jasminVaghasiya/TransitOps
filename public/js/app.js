// ==========================================
// TRANSITOPS FRONTEND APPLICATION SCRIPT
// ==========================================

let accessToken = null;
let currentUser = null;
let currentActivePage = 'dashboard';
let refreshInterval = null;

// ==========================================
// CLIENT AUTHORIZATION & PERMISSION ENGINE (RBAC)
// ==========================================
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

function can(action, subject) {
  if (!currentUser || !currentUser.role) return false;
  const abilities = ROLE_ABILITIES[currentUser.role];
  if (!abilities) return false;

  // Admin bypass
  if (abilities['manage'] && abilities['manage'].includes('all')) {
    return true;
  }

  // Action check
  const subjectsForAction = abilities[action];
  if (subjectsForAction && (subjectsForAction.includes(subject) || subjectsForAction.includes('all'))) {
    return true;
  }

  // General subject manage scope
  const manageSubjects = abilities['manage'];
  if (manageSubjects && (manageSubjects.includes(subject) || manageSubjects.includes('all'))) {
    return true;
  }

  // Reading bypass on wildcard
  if (action === 'read' && abilities['read'] && abilities['read'].includes('all')) {
    return true;
  }

  return false;
}

// DOM Elements cache
const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const userNameEl = document.getElementById('user-name');
const userRoleEl = document.getElementById('user-role');
const welcomeUserEl = document.getElementById('welcome-user');
const welcomeRoleEl = document.getElementById('welcome-role');
const pageTitleEl = document.getElementById('page-title');
const logoutBtn = document.getElementById('logout-btn');
const quickCreateBtn = document.getElementById('quick-create-btn');
const toastContainer = document.getElementById('toast-container');

// Modal Elements
const modalContainer = document.getElementById('modal-container');
const modalClose = document.getElementById('modal-close');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');

// Navigation links
const navLinks = document.querySelectorAll('.nav-link');
const pageSections = document.querySelectorAll('.page-content');

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️'}</span>
    <div>${message}</div>
  `;
  toastContainer.appendChild(toast);

  // Auto remove toast
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// API CLIENT UTILITY (JWT AUTHENTICATION)
// ==========================================
async function fetchAPI(url, options = {}) {
  options.headers = options.headers || {};
  if (accessToken) {
    options.headers['Authorization'] = `Bearer ${accessToken}`;
  }
  options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';

  try {
    let res = await fetch(url, options);

    // If Access Token is expired (401), try silent token refreshing
    if (res.status === 401 && accessToken) {
      console.warn('Access token expired. Requesting silent refresh...');
      const refreshed = await performSilentRefresh();
      
      if (refreshed) {
        // Retry the original request with the new access token
        options.headers['Authorization'] = `Bearer ${accessToken}`;
        res = await fetch(url, options);
      } else {
        // Refresh failed, redirect to login
        handleSignOut();
        return null;
      }
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.errors?.join('. ') || 'API Request failed');
    }
    return data;
  } catch (error) {
    showToast(error.message, 'error');
    console.error('API Error:', error);
    throw error;
  }
}

// Silent Refresh token request
async function performSilentRefresh() {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      accessToken = data.data.accessToken;
      return true;
    }
    return false;
  } catch (err) {
    console.error('Silent refresh failed:', err);
    return false;
  }
}

// ==========================================
// USER LOGIN & INITIALIZATION
// ==========================================
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = loginEmailInput.value;
  const password = loginPasswordInput.value;

  try {
    const response = await fetchAPI('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (response && response.status === 'success') {
      accessToken = response.data.accessToken;
      currentUser = response.data.user;
      
      showToast(`Welcome back, ${currentUser.name}!`, 'success');
      initializeDashboard();
    }
  } catch (error) {
    // Error toast already shown by fetchAPI
  }
});

// Demo Buttons quick credentials
document.querySelectorAll('.demo-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    loginEmailInput.value = btn.dataset.email;
    loginPasswordInput.value = 'password123Secure!';
    loginForm.dispatchEvent(new Event('submit'));
  });
});

function initializeDashboard() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');

  // Fill profile details
  userNameEl.textContent = currentUser.name;
  userRoleEl.textContent = currentUser.role.replace('_', ' ');
  welcomeUserEl.textContent = currentUser.name;
  welcomeRoleEl.textContent = currentUser.role.replace('_', ' ');

  // Enable/disable navigation tabs based on user permissions
  configureNavigation(currentUser.role);

  // Default page loading
  loadPage('dashboard');

  // Set up refresh timer (every 10 minutes)
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(performSilentRefresh, 10 * 60 * 1000);
}

function configureNavigation(role) {
  // Hide all sections first, then selectively show based on permissions
  const hiddenSelectors = {
    fleet_manager: ['#nav-finance', '#nav-audit'],
    dispatcher: ['#nav-finance', '#nav-audit'],
    safety_officer: ['#nav-finance', '#nav-audit'],
    financial_analyst: ['#nav-audit'],
    read_only: ['#nav-audit'],
  };

  // Reset navigation visibility
  document.querySelectorAll('.nav-link').forEach(link => link.parentElement.classList.remove('hidden'));

  // Hide restricted links
  const restricted = hiddenSelectors[role];
  if (restricted) {
    restricted.forEach(selector => {
      const link = document.querySelector(selector);
      if (link) link.parentElement.classList.add('hidden');
    });
  }

  // Quick Create Button visibility default configure
  quickCreateBtn.classList.add('hidden');
}

// ==========================================
// NAVIGATION & PAGE LOADING
// ==========================================
navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;

    navLinks.forEach(l => l.classList.remove('active'));
    link.classList.add('active');

    loadPage(page);
  });
});

function loadPage(page) {
  currentActivePage = page;
  
  // Update Title
  pageTitleEl.textContent = page.charAt(0).toUpperCase() + page.slice(1) + ' Workspace';

  // Configure "+ Create Resource" button visibility dynamically using permissions
  let subject = '';
  if (page === 'vehicles') subject = 'Vehicle';
  else if (page === 'drivers') subject = 'Driver';
  else if (page === 'trips') subject = 'Trip';
  else if (page === 'maintenance') subject = 'Maintenance';
  else if (page === 'finance') subject = 'Expense';

  if (subject && can('create', subject)) {
    quickCreateBtn.classList.remove('hidden');
  } else {
    quickCreateBtn.classList.add('hidden');
  }

  // Toggle active views
  pageSections.forEach(section => {
    if (section.id === `page-${page}`) {
      section.classList.remove('hidden');
    } else {
      section.classList.add('hidden');
    }
  });

  // Pull active database tables
  if (page === 'dashboard') {
    loadDashboardStats();
  } else if (page === 'vehicles') {
    loadVehicles();
  } else if (page === 'drivers') {
    loadDrivers();
  } else if (page === 'trips') {
    loadTrips();
  } else if (page === 'maintenance') {
    loadMaintenance();
  } else if (page === 'finance') {
    loadFinance();
  } else if (page === 'audit') {
    loadAuditLogs();
  }
}

// ==========================================
// DATA LOADING FUNCTIONS
// ==========================================

async function loadDashboardStats() {
  try {
    const vehiclesData = await fetchAPI('/api/vehicles');
    const driversData = await fetchAPI('/api/drivers');
    const tripsData = await fetchAPI('/api/trips');
    const maintData = await fetchAPI('/api/maintenance');

    document.getElementById('stat-vehicles').textContent = vehiclesData.data.pagination.total;
    document.getElementById('stat-drivers').textContent = driversData.data.pagination.total;
    document.getElementById('stat-trips').textContent = tripsData.data.pagination.total;
    document.getElementById('stat-maint').textContent = maintData.data.pagination.total;

    // Load recent logs
    if (currentUser.role === 'admin') {
      const logsData = await fetchAPI('/api/users/audit?limit=5');
      const recentLogsEl = document.getElementById('recent-logs');
      recentLogsEl.innerHTML = '';

      if (logsData.data.logs.length === 0) {
        recentLogsEl.innerHTML = '<p class="empty-message">No recent logs recorded</p>';
      } else {
        logsData.data.logs.forEach(log => {
          const item = document.createElement('div');
          item.className = 'log-item';
          item.innerHTML = `
            <div>
              <span class="log-text"><strong>${log.user?.name || 'System'}</strong> did <strong>${log.action}</strong> on <strong>${log.module}</strong></span>
            </div>
            <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
          `;
          recentLogsEl.appendChild(item);
        });
      }
    } else {
      document.getElementById('recent-logs').innerHTML = '<p class="empty-message">Activity log viewing restricted to administrators.</p>';
    }
  } catch (err) {
    console.error('Failed to load dashboard statistics:', err);
  }
}

async function loadVehicles() {
  const container = document.getElementById('vehicles-list');
  container.innerHTML = '<tr><td colspan="5" class="empty-message">Loading Vehicles...</td></tr>';
  
  try {
    const response = await fetchAPI('/api/vehicles');
    container.innerHTML = '';
    
    if (response.data.vehicles.length === 0) {
      container.innerHTML = '<tr><td colspan="5" class="empty-message">No vehicles found.</td></tr>';
      return;
    }

    const hasActions = can('update', 'Vehicle') || can('retire', 'Vehicle');
    
    // Toggle actions header visibility
    const actionsHeader = document.querySelector('#vehicles-table th:last-child');
    if (actionsHeader) {
      if (hasActions) actionsHeader.classList.remove('hidden');
      else actionsHeader.classList.add('hidden');
    }

    response.data.vehicles.forEach(vehicle => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${vehicle.registrationNumber}</strong></td>
        <td>${vehicle.make} ${vehicle.modelName}</td>
        <td>${vehicle.capacityKg.toLocaleString()} Kg</td>
        <td><span class="badge status-${vehicle.status.replace(' ', '-')}">${vehicle.status}</span></td>
        ${hasActions ? `
        <td>
          ${can('update', 'Vehicle') ? `<button class="btn btn-outline edit-vehicle-btn" data-id="${vehicle._id}" style="padding: 5px 10px; font-size:11px;">Edit</button>` : ''}
          ${can('retire', 'Vehicle') && vehicle.status !== 'Retired' ? `<button class="btn btn-logout retire-vehicle-btn" data-id="${vehicle._id}" style="padding: 5px 10px; font-size:11px; margin-left: 5px;">Retire</button>` : ''}
        </td>
        ` : ''}
      `;
      container.appendChild(row);
    });

    // Wire actions
    document.querySelectorAll('.retire-vehicle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to retire this vehicle? This operation is final.')) {
          await fetchAPI(`/api/vehicles/${btn.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Retired' })
          });
          showToast('Vehicle retired successfully');
          loadVehicles();
        }
      });
    });
  } catch (err) {}
}

async function loadDrivers() {
  const container = document.getElementById('drivers-list');
  container.innerHTML = '<tr><td colspan="7" class="empty-message">Loading Drivers...</td></tr>';
  
  try {
    const response = await fetchAPI('/api/drivers');
    container.innerHTML = '';

    if (response.data.drivers.length === 0) {
      container.innerHTML = '<tr><td colspan="7" class="empty-message">No drivers registered.</td></tr>';
      return;
    }

    const hasActions = can('score', 'Driver');
    
    // Toggle actions header visibility
    const actionsHeader = document.querySelector('#drivers-table th:last-child');
    if (actionsHeader) {
      if (hasActions) actionsHeader.classList.remove('hidden');
      else actionsHeader.classList.add('hidden');
    }

    response.data.drivers.forEach(driver => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${driver.name}</strong></td>
        <td>${driver.licenseNumber}</td>
        <td>${new Date(driver.licenseExpiry).toLocaleDateString()}</td>
        <td>${driver.phone}</td>
        <td>⭐ ${driver.safetyScore} / 100</td>
        <td><span class="badge status-${driver.status.replace(' ', '-')}">${driver.status}</span></td>
        ${hasActions ? `
        <td>
          <button class="btn btn-outline edit-driver-btn" data-id="${driver._id}" style="padding: 5px 10px; font-size:11px;">Update Score</button>
        </td>
        ` : ''}
      `;
      container.appendChild(row);
    });
  } catch (err) {}
}

async function loadTrips() {
  const container = document.getElementById('trips-list');
  container.innerHTML = '<tr><td colspan="6" class="empty-message">Loading Trips...</td></tr>';
  
  try {
    const response = await fetchAPI('/api/trips');
    container.innerHTML = '';

    if (response.data.trips.length === 0) {
      container.innerHTML = '<tr><td colspan="6" class="empty-message">No trip schedules found.</td></tr>';
      return;
    }

    const hasActions = can('dispatch', 'Trip') || can('complete', 'Trip') || can('cancel', 'Trip');
    
    // Toggle actions header visibility
    const actionsHeader = document.querySelector('#trips-table th:last-child');
    if (actionsHeader) {
      if (hasActions) actionsHeader.classList.remove('hidden');
      else actionsHeader.classList.add('hidden');
    }

    response.data.trips.forEach(trip => {
      const row = document.createElement('tr');
      const isDraft = trip.status === 'Draft';
      const isDispatched = trip.status === 'Dispatched';

      row.innerHTML = `
        <td><strong>${trip.vehicle?.registrationNumber || 'Unknown'}</strong></td>
        <td>${trip.driver?.name || 'Unknown'}</td>
        <td>${trip.source} ➔ ${trip.destination} (${trip.distanceKm} km)</td>
        <td>${trip.cargoWeightKg.toLocaleString()} Kg</td>
        <td><span class="badge status-${trip.status}">${trip.status}</span></td>
        ${hasActions ? `
        <td>
          ${isDraft && can('dispatch', 'Trip') ? `<button class="btn btn-primary dispatch-trip-btn" data-id="${trip._id}" style="padding: 5px 10px; font-size:11px;">Dispatch</button>` : ''}
          ${isDispatched && can('complete', 'Trip') ? `<button class="btn btn-outline complete-trip-btn" data-id="${trip._id}" style="padding: 5px 10px; font-size:11px; color: var(--color-success);">Complete</button>` : ''}
          ${(isDraft || isDispatched) && can('cancel', 'Trip') ? `<button class="btn btn-logout cancel-trip-btn" data-id="${trip._id}" style="padding: 5px 10px; font-size:11px; margin-left: 5px;">Cancel</button>` : ''}
        </td>
        ` : ''}
      `;
      container.appendChild(row);
    });

    // Wire actions
    document.querySelectorAll('.dispatch-trip-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetchAPI(`/api/trips/${btn.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Dispatched' })
        });
        showToast('Trip Dispatched! Driver and Vehicle statuses locked to On Trip');
        loadTrips();
      });
    });

    document.querySelectorAll('.complete-trip-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetchAPI(`/api/trips/${btn.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Completed' })
        });
        showToast('Trip Completed! Vehicle & Driver released back to Available');
        loadTrips();
      });
    });

    document.querySelectorAll('.cancel-trip-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Cancel this trip?')) {
          await fetchAPI(`/api/trips/${btn.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Cancelled' })
          });
          showToast('Trip Cancelled.');
          loadTrips();
        }
      });
    });
  } catch (err) {}
}

async function loadMaintenance() {
  const container = document.getElementById('maintenance-list');
  container.innerHTML = '<tr><td colspan="5" class="empty-message">Loading Maintenance records...</td></tr>';
  
  try {
    const response = await fetchAPI('/api/maintenance');
    container.innerHTML = '';

    if (response.data.logs.length === 0) {
      container.innerHTML = '<tr><td colspan="5" class="empty-message">No maintenance logs found.</td></tr>';
      return;
    }

    const hasActions = can('close', 'Maintenance');
    
    // Toggle actions header visibility
    const actionsHeader = document.querySelector('#maintenance-table th:last-child');
    if (actionsHeader) {
      if (hasActions) actionsHeader.classList.remove('hidden');
      else actionsHeader.classList.add('hidden');
    }

    response.data.logs.forEach(log => {
      const row = document.createElement('tr');
      const isActive = log.status === 'Active';

      row.innerHTML = `
        <td><strong>${log.vehicle?.registrationNumber || 'Unknown'}</strong></td>
        <td>${log.description}</td>
        <td>$ ${log.cost.toLocaleString()}</td>
        <td><span class="badge status-${log.status}">${log.status}</span></td>
        ${hasActions ? `
        <td>
          ${isActive ? `<button class="btn btn-outline close-maint-btn" data-id="${log._id}" style="padding: 5px 10px; font-size:11px; color: var(--color-success);">Close Repair</button>` : '—'}
        </td>
        ` : ''}
      `;
      container.appendChild(row);
    });

    document.querySelectorAll('.close-maint-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetchAPI(`/api/maintenance/${btn.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Closed' })
        });
        showToast('Maintenance closed! Vehicle released back to Available status.');
        loadMaintenance();
      });
    });
  } catch (err) {}
}

async function loadFinance() {
  loadExpenses();
  loadFuelLogs();
}

async function loadExpenses() {
  const container = document.getElementById('expenses-list');
  container.innerHTML = '<tr><td colspan="6" class="empty-message">Loading Expenses...</td></tr>';
  
  try {
    const response = await fetchAPI('/api/expenses');
    container.innerHTML = '';

    if (response.data.expenses.length === 0) {
      container.innerHTML = '<tr><td colspan="6" class="empty-message">No expense invoices registered.</td></tr>';
      return;
    }

    const hasActions = can('approve', 'Expense');
    
    // Toggle actions header visibility
    const actionsHeader = document.querySelector('#expenses-table th:last-child');
    if (actionsHeader) {
      if (hasActions) actionsHeader.classList.remove('hidden');
      else actionsHeader.classList.add('hidden');
    }

    response.data.expenses.forEach(exp => {
      const row = document.createElement('tr');
      const isPending = exp.status === 'Pending';

      row.innerHTML = `
        <td><strong>${exp.expenseType}</strong></td>
        <td>$ ${exp.amount.toLocaleString()}</td>
        <td>${new Date(exp.date).toLocaleDateString()}</td>
        <td>${exp.vehicle?.registrationNumber || 'N/A'}</td>
        <td><span class="badge status-${exp.status}">${exp.status}</span></td>
        ${hasActions ? `
        <td>
          ${isPending ? `<button class="btn btn-outline approve-expense-btn" data-id="${exp._id}" style="padding: 5px 10px; font-size:11px; color: var(--color-success);">Approve</button>` : '—'}
        </td>
        ` : ''}
      `;
      container.appendChild(row);
    });

    document.querySelectorAll('.approve-expense-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetchAPI(`/api/expenses/${btn.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Approved' })
        });
        showToast('Expense invoice approved successfully');
        loadExpenses();
      });
    });
  } catch (err) {}
}

async function loadFuelLogs() {
  const container = document.getElementById('fuel-list');
  container.innerHTML = '<tr><td colspan="5" class="empty-message">Loading Fuel logs...</td></tr>';
  
  try {
    const response = await fetchAPI('/api/expenses/fuel');
    container.innerHTML = '';

    if (response.data.fuelLogs.length === 0) {
      container.innerHTML = '<tr><td colspan="5" class="empty-message">No fuel fill logs registered.</td></tr>';
      return;
    }

    response.data.fuelLogs.forEach(log => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${log.vehicle?.registrationNumber || 'Unknown'}</strong></td>
        <td>${new Date(log.date).toLocaleDateString()}</td>
        <td>${log.fuelLiters} L</td>
        <td>$ ${log.cost.toLocaleString()}</td>
        <td>📟 ${log.odometer.toLocaleString()} Km</td>
      `;
      container.appendChild(row);
    });
  } catch (err) {}
}

async function loadAuditLogs() {
  const container = document.getElementById('audit-list');
  container.innerHTML = '<tr><td colspan="6" class="empty-message">Loading Audit logs...</td></tr>';
  
  try {
    const response = await fetchAPI('/api/users/audit');
    container.innerHTML = '';

    if (response.data.logs.length === 0) {
      container.innerHTML = '<tr><td colspan="6" class="empty-message">No audit trails written.</td></tr>';
      return;
    }

    response.data.logs.forEach(log => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${new Date(log.timestamp).toLocaleString()}</td>
        <td><strong>${log.user?.name || 'System'}</strong> (${log.user?.role || 'System'})</td>
        <td><span class="badge status-${log.action}">${log.action}</span></td>
        <td>${log.module}</td>
        <td><code>${log.recordId}</code></td>
        <td><code>${log.ipAddress}</code></td>
      `;
      container.appendChild(row);
    });
  } catch (err) {}
}

// Financial Analyst tab toggling
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;
    document.getElementById('tab-content-expenses').classList.add('hidden');
    document.getElementById('tab-content-fuel').classList.add('hidden');
    document.getElementById(`tab-content-${tab}`).classList.remove('hidden');
  });
});

// ==========================================
// LOGOUT ROUTINE
// ==========================================
async function handleSignOut() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  
  accessToken = null;
  currentUser = null;
  if (refreshInterval) clearInterval(refreshInterval);

  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
  loginPasswordInput.value = '';
  showToast('Logged out successfully', 'info');
}

logoutBtn.addEventListener('click', handleSignOut);

// ==========================================
// MODAL & QUICK CREATES
// ==========================================
modalClose.addEventListener('click', () => {
  modalContainer.classList.add('hidden');
});

quickCreateBtn.addEventListener('click', () => {
  modalContainer.classList.remove('hidden');
  modalTitle.textContent = `Create New ${currentActivePage.charAt(0).toUpperCase() + currentActivePage.slice(1, -1)}`;

  if (currentActivePage === 'vehicles') {
    renderVehicleForm();
  } else if (currentActivePage === 'drivers') {
    renderDriverForm();
  } else if (currentActivePage === 'trips') {
    renderTripForm();
  } else if (currentActivePage === 'maintenance') {
    renderMaintenanceForm();
  } else if (currentActivePage === 'finance') {
    renderFinanceForm();
  } else {
    modalContainer.classList.add('hidden');
    showToast('Select a section (Vehicles, Drivers, Trips, Maintenance, Expenses) to create records.', 'warning');
  }
});

function renderVehicleForm() {
  modalBody.innerHTML = `
    <form id="create-vehicle-form">
      <div class="input-group">
        <label>Registration Number</label>
        <input type="text" id="veh-reg" required placeholder="TX-123-GP">
      </div>
      <div class="input-group">
        <label>Make</label>
        <input type="text" id="veh-make" required placeholder="Volvo">
      </div>
      <div class="input-group">
        <label>Model Name</label>
        <input type="text" id="veh-model" required placeholder="FH16">
      </div>
      <div class="input-group">
        <label>Capacity (Kg)</label>
        <input type="number" id="veh-cap" required placeholder="20000">
      </div>
      <button type="submit" class="btn btn-primary btn-block">Add Vehicle</button>
    </form>
  `;

  document.getElementById('create-vehicle-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchAPI('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          registrationNumber: document.getElementById('veh-reg').value,
          make: document.getElementById('veh-make').value,
          modelName: document.getElementById('veh-model').value,
          capacityKg: parseFloat(document.getElementById('veh-cap').value),
        }),
      });
      showToast('Vehicle created successfully!');
      modalContainer.classList.add('hidden');
      loadVehicles();
    } catch (err) {}
  });
}

function renderDriverForm() {
  modalBody.innerHTML = `
    <form id="create-driver-form">
      <div class="input-group">
        <label>Driver Full Name</label>
        <input type="text" id="drv-name" required placeholder="John Doe">
      </div>
      <div class="input-group">
        <label>License Number</label>
        <input type="text" id="drv-lic" required placeholder="DL-98754-TX">
      </div>
      <div class="input-group">
        <label>License Expiry Date</label>
        <input type="date" id="drv-expiry" required>
      </div>
      <div class="input-group">
        <label>Phone Number (E.164)</label>
        <input type="text" id="drv-phone" required placeholder="+15550199">
      </div>
      <button type="submit" class="btn btn-primary btn-block">Register Driver</button>
    </form>
  `;

  document.getElementById('create-driver-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchAPI('/api/drivers', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('drv-name').value,
          licenseNumber: document.getElementById('drv-lic').value,
          licenseExpiry: document.getElementById('drv-expiry').value,
          phone: document.getElementById('drv-phone').value,
        }),
      });
      showToast('Driver registered successfully!');
      modalContainer.classList.add('hidden');
      loadDrivers();
    } catch (err) {}
  });
}

async function renderTripForm() {
  modalBody.innerHTML = 'Loading active fleet lists...';

  try {
    const vehiclesData = await fetchAPI('/api/vehicles');
    const driversData = await fetchAPI('/api/drivers');

    const availableVehicles = vehiclesData.data.vehicles.filter(v => v.status === 'Available');
    const availableDrivers = driversData.data.drivers.filter(d => d.status === 'Available');

    let vehOptions = availableVehicles.map(v => `<option value="${v._id}">${v.registrationNumber} (Max ${v.capacityKg} kg)</option>`).join('');
    let drvOptions = availableDrivers.map(d => `<option value="${d._id}">${d.name} (License ok)</option>`).join('');

    modalBody.innerHTML = `
      <form id="create-trip-form">
        <div class="input-group">
          <label>Select Available Vehicle</label>
          <select id="trip-veh" required>${vehOptions ? vehOptions : '<option value="">No available vehicles</option>'}</select>
        </div>
        <div class="input-group">
          <label>Select Available Driver</label>
          <select id="trip-drv" required>${drvOptions ? drvOptions : '<option value="">No available drivers</option>'}</select>
        </div>
        <div class="input-group">
          <label>Source Location</label>
          <input type="text" id="trip-source" required placeholder="Houston Cargo Terminal">
        </div>
        <div class="input-group">
          <label>Destination Location</label>
          <input type="text" id="trip-dest" required placeholder="Dallas Logistics Center">
        </div>
        <div class="input-group">
          <label>Cargo Description</label>
          <input type="text" id="trip-desc" required placeholder="Industrial Machinery components">
        </div>
        <div class="input-group">
          <label>Cargo Weight (Kg)</label>
          <input type="number" id="trip-weight" required placeholder="12500">
        </div>
        <div class="input-group">
          <label>Distance (Km)</label>
          <input type="number" id="trip-dist" required placeholder="380">
        </div>
        <button type="submit" class="btn btn-primary btn-block">Schedule Trip (Draft)</button>
      </form>
    `;

    document.getElementById('create-trip-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchAPI('/api/trips', {
          method: 'POST',
          body: JSON.stringify({
            vehicle: document.getElementById('trip-veh').value,
            driver: document.getElementById('trip-drv').value,
            source: document.getElementById('trip-source').value,
            destination: document.getElementById('trip-dest').value,
            cargoDescription: document.getElementById('trip-desc').value,
            cargoWeightKg: parseFloat(document.getElementById('trip-weight').value),
            distanceKm: parseFloat(document.getElementById('trip-dist').value),
          }),
        });
        showToast('Trip scheduled as Draft. Dispatch it when ready.');
        modalContainer.classList.add('hidden');
        loadTrips();
      } catch (err) {}
    });
  } catch (err) {
    modalBody.innerHTML = 'Failed to load options.';
  }
}

async function renderMaintenanceForm() {
  modalBody.innerHTML = 'Loading fleet list...';

  try {
    const vehiclesData = await fetchAPI('/api/vehicles');
    const availableVehicles = vehiclesData.data.vehicles.filter(v => v.status === 'Available');

    let options = availableVehicles.map(v => `<option value="${v._id}">${v.registrationNumber} - ${v.make} ${v.modelName}</option>`).join('');

    modalBody.innerHTML = `
      <form id="create-maint-form">
        <div class="input-group">
          <label>Select Available Vehicle</label>
          <select id="maint-veh" required>${options ? options : '<option value="">No available vehicles</option>'}</select>
        </div>
        <div class="input-group">
          <label>Repair Description</label>
          <input type="text" id="maint-desc" required placeholder="Brake pad replacement and diagnostics">
        </div>
        <div class="input-group">
          <label>Cost ($)</label>
          <input type="number" id="maint-cost" required placeholder="450">
        </div>
        <button type="submit" class="btn btn-primary btn-block">Send to Shop</button>
      </form>
    `;

    document.getElementById('create-maint-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchAPI('/api/maintenance', {
          method: 'POST',
          body: JSON.stringify({
            vehicle: document.getElementById('maint-veh').value,
            description: document.getElementById('maint-desc').value,
            cost: parseFloat(document.getElementById('maint-cost').value),
          }),
        });
        showToast('Maintenance logged. Vehicle status changed to In Shop.');
        modalContainer.classList.add('hidden');
        loadMaintenance();
      } catch (err) {}
    });
  } catch (err) {
    modalBody.innerHTML = 'Failed to load vehicle options.';
  }
}

async function renderFinanceForm() {
  modalBody.innerHTML = `
    <div class="tabs" style="margin-bottom: 20px;">
      <button type="button" class="tab-btn active" id="modal-tab-expense">New Expense</button>
      <button type="button" class="tab-btn" id="modal-tab-fuel">New Fuel Log</button>
    </div>
    <div id="modal-form-container"></div>
  `;

  const formContainer = document.getElementById('modal-form-container');

  const showExpenseForm = () => {
    formContainer.innerHTML = `
      <form id="create-expense-form">
        <div class="input-group">
          <label>Expense Type</label>
          <input type="text" id="exp-type" required placeholder="Tolls, Insurance, Tires...">
        </div>
        <div class="input-group">
          <label>Amount ($)</label>
          <input type="number" id="exp-amt" required placeholder="120">
        </div>
        <div class="input-group">
          <label>Date</label>
          <input type="date" id="exp-date" required>
        </div>
        <div class="input-group">
          <label>Description</label>
          <textarea id="exp-desc" placeholder="Details..."></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Create Pending Invoice</button>
      </form>
    `;

    document.getElementById('create-expense-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchAPI('/api/expenses', {
          method: 'POST',
          body: JSON.stringify({
            expenseType: document.getElementById('exp-type').value,
            amount: parseFloat(document.getElementById('exp-amt').value),
            date: document.getElementById('exp-date').value,
            description: document.getElementById('exp-desc').value,
          }),
        });
        showToast('Expense created and placed in Pending approval.');
        modalContainer.classList.add('hidden');
        loadExpenses();
      } catch (err) {}
    });
  };

  const showFuelForm = async () => {
    formContainer.innerHTML = 'Loading vehicle list...';
    try {
      const vehiclesData = await fetchAPI('/api/vehicles');
      let options = vehiclesData.data.vehicles.map(v => `<option value="${v._id}">${v.registrationNumber}</option>`).join('');

      formContainer.innerHTML = `
        <form id="create-fuel-form">
          <div class="input-group">
            <label>Select Vehicle</label>
            <select id="fuel-veh" required>${options}</select>
          </div>
          <div class="input-group">
            <label>Fuel Liters</label>
            <input type="number" id="fuel-lit" required placeholder="75">
          </div>
          <div class="input-group">
            <label>Cost ($)</label>
            <input type="number" id="fuel-cost" required placeholder="280">
          </div>
          <div class="input-group">
            <label>Odometer Reading (Km)</label>
            <input type="number" id="fuel-odo" required placeholder="124500">
          </div>
          <button type="submit" class="btn btn-primary btn-block">Record Fill-Up</button>
        </form>
      `;

      document.getElementById('create-fuel-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await fetchAPI('/api/expenses/fuel', {
            method: 'POST',
            body: JSON.stringify({
              vehicle: document.getElementById('fuel-veh').value,
              fuelLiters: parseFloat(document.getElementById('fuel-lit').value),
              cost: parseFloat(document.getElementById('fuel-cost').value),
              odometer: parseFloat(document.getElementById('fuel-odo').value),
            }),
          });
          showToast('Fuel log recorded successfully.');
          modalContainer.classList.add('hidden');
          loadFuelLogs();
        } catch (err) {}
      });
    } catch (err) {
      formContainer.innerHTML = 'Failed to load options.';
    }
  };

  // Wire tab toggling in modal
  const expBtn = document.getElementById('modal-tab-expense');
  const fuelBtn = document.getElementById('modal-tab-fuel');

  expBtn.addEventListener('click', () => {
    expBtn.classList.add('active');
    fuelBtn.classList.remove('active');
    showExpenseForm();
  });

  fuelBtn.addEventListener('click', () => {
    fuelBtn.classList.add('active');
    expBtn.classList.remove('active');
    showFuelForm();
  });

  // Default modal sub-form
  showExpenseForm();
}
