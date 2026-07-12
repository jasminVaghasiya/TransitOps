// ==========================================
// TRANSITOPS FRONTEND SPA CLIENT CONTROLLER
// ==========================================

let accessToken = null;
let currentUser = null;
let currentActivePage = 'dashboard';
let refreshInterval = null;

const DEFAULT_VEHICLE_PHOTO = 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=400&q=80';

const toBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

// ==========================================
// CLIENT AUTHORIZATION RULES (RBAC)
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
    sell: ['Vehicle'],
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

// ==========================================
// DOM ELEMENT CACHE
// ==========================================
const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const userDisplayName = document.getElementById('user-display-name');
const userDisplayRole = document.getElementById('user-display-role');
const welcomeProfileName = document.getElementById('welcome-profile-name');
const welcomeProfileRole = document.getElementById('welcome-profile-role');
const logoutBtn = document.getElementById('logout-btn');
const toastContainer = document.getElementById('toast-container');
const floatingActionBtn = document.getElementById('floating-action-btn');

// Navigation elements
const navLinks = document.querySelectorAll('.nav-link');
const pageSections = document.querySelectorAll('.page-content');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.getElementById('sidebar');
const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const navProfileMenu = document.getElementById('nav-profile-menu');
const profileDropdownContent = document.getElementById('profile-dropdown-content');
const profileSignout = document.getElementById('profile-signout');

// Modal Dialog components
const modalContainer = document.getElementById('modal-container');
const modalClose = document.getElementById('modal-close');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');

// ==========================================
// TOAST ALERTS & NOTIFICATIONS
// ==========================================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="${type === 'success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'}"></i>
    <div>${message}</div>
  `;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeIn 0.3s ease-out reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// CORE REST CLIENT WRAPPER (JWT FLOW)
// ==========================================
async function fetchAPI(url, options = {}) {
  options.headers = options.headers || {};
  if (accessToken) {
    options.headers['Authorization'] = `Bearer ${accessToken}`;
  }
  options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';

  try {
    let res = await fetch(url, options);

    // Silent session token refresh on 401 Unauthorized
    if (res.status === 401 && accessToken) {
      console.warn('Session access token expired. Triggering silent refresh...');
      const refreshed = await performSilentRefresh();
      
      if (refreshed) {
        options.headers['Authorization'] = `Bearer ${accessToken}`;
        res = await fetch(url, options);
      } else {
        handleLogout();
        return null;
      }
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.errors?.join('. ') || 'Logistics API operation failed');
    }
    return data;
  } catch (error) {
    showToast(error.message, 'error');
    console.error('API Error:', error);
    throw error;
  }
}

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
    console.error('Silent refresh failure:', err);
    return false;
  }
}

// ==========================================
// LOGIN & CREDENTIAL EVENTS
// ==========================================
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginEmailInput.value;
  const password = loginPasswordInput.value;
  const errorBox = document.getElementById('login-error-box');
  if (errorBox) errorBox.classList.add('hidden');

  try {
    const response = await fetchAPI('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (response && response.status === 'success') {
      accessToken = response.data.accessToken;
      currentUser = response.data.user;
      
      showToast(`Logged in successfully. Welcome back, ${currentUser.name}!`, 'success');
      initializeDashboard();
    }
  } catch (error) {
    if (errorBox) {
      errorBox.classList.remove('hidden');
      const errorMsg = document.getElementById('login-error-message');
      if (errorMsg) errorMsg.textContent = error.message || 'Invalid credentials.';
    }
  }
});

// Demo Buttons quick credentials loader
document.querySelectorAll('.role-item').forEach(btn => {
  btn.addEventListener('click', () => {
    loginEmailInput.value = btn.dataset.email;
    loginPasswordInput.value = 'password123Secure!';
    const roleSelect = document.getElementById('login-role');
    if (roleSelect && btn.dataset.role) {
      roleSelect.value = btn.dataset.role;
    }
    loginForm.dispatchEvent(new Event('submit'));
  });
});

function initializeDashboard() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');

  // Fill in active user details
  userDisplayName.textContent = currentUser.name;
  userDisplayRole.textContent = currentUser.role.replace('_', ' ');
  welcomeProfileName.textContent = currentUser.name;
  welcomeProfileRole.textContent = currentUser.role.replace('_', ' ');

  // Fill in navbar profile details
  const navbarNameEl = document.getElementById('navbar-user-name');
  const navbarRoleEl = document.getElementById('navbar-user-role');
  const navbarAvatarEl = document.getElementById('navbar-user-avatar');
  if (navbarNameEl) navbarNameEl.textContent = currentUser.name;
  if (navbarRoleEl) navbarRoleEl.textContent = currentUser.role.replace('_', ' ');
  if (navbarAvatarEl) {
    const names = currentUser.name.split(' ');
    const initials = names.map(n => n[0]).join('').substring(0, 2).toUpperCase();
    navbarAvatarEl.textContent = initials;
  }

  // Enable/disable navigation items based on active role scopes
  configureNavigation(currentUser.role);

  // Load default dashboard
  loadPage('dashboard');

  // Bind dashboard filters change events
  const typeFilter = document.getElementById('dash-filter-type');
  const regionFilter = document.getElementById('dash-filter-region');
  const statusFilter = document.getElementById('dash-filter-status');

  if (typeFilter) typeFilter.addEventListener('change', loadDashboardStats);
  if (regionFilter) regionFilter.addEventListener('change', loadDashboardStats);
  if (statusFilter) statusFilter.addEventListener('change', loadDashboardStats);

  // Silent refresh checker (every 10 minutes)
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(performSilentRefresh, 10 * 60 * 1000);
}

function configureNavigation(role) {
  const hiddenSelectors = {
    fleet_manager: ['#nav-finance', '#nav-audit', '#nav-users', '#nav-roles'],
    dispatcher: ['#nav-finance', '#nav-audit', '#nav-users', '#nav-roles'],
    safety_officer: ['#nav-finance', '#nav-audit', '#nav-users', '#nav-roles'],
    financial_analyst: ['#nav-audit', '#nav-users', '#nav-roles'],
    read_only: ['#nav-audit', '#nav-users', '#nav-roles'],
  };

  // Reset menu lists visibility
  document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('hidden'));

  // Hide restricted panels
  const restricted = hiddenSelectors[role];
  if (restricted) {
    restricted.forEach(selector => {
      const link = document.querySelector(selector);
      if (link) link.parentElement.classList.add('hidden');
    });
  }

  // Floating Action Button visibility based on active page roles
  updateFABVisibility();
}

function updateFABVisibility() {
  let subject = '';
  if (currentActivePage === 'vehicles') subject = 'Vehicle';
  else if (currentActivePage === 'drivers') subject = 'Driver';
  else if (currentActivePage === 'trips') subject = 'Trip';
  else if (currentActivePage === 'maintenance') subject = 'Maintenance';
  else if (currentActivePage === 'finance') subject = 'Expense';

  if (subject && can('create', subject)) {
    floatingActionBtn.classList.remove('hidden');
  } else {
    floatingActionBtn.classList.add('hidden');
  }
}

// ==========================================
// SYSTEM LAYOUT EVENTS (SIDEBAR & THEMES)
// ==========================================
sidebarCollapseBtn.addEventListener('click', () => {
  appView.classList.toggle('collapsed-sidebar');
});

// Mobile layout drawer
mobileMenuBtn.addEventListener('click', () => {
  sidebar.classList.add('mobile-open');
  sidebarOverlay.classList.remove('hidden');
});

sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.remove('mobile-open');
  sidebarOverlay.classList.add('hidden');
});

// Dark/Light theme toggler
themeToggleBtn.addEventListener('click', () => {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  themeToggleBtn.innerHTML = isLight ? '<i class="fa-regular fa-sun"></i>' : '<i class="fa-regular fa-moon"></i>';
});

// Profile dropdown dropper toggle
navProfileMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  profileDropdownContent.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  profileDropdownContent.classList.add('hidden');
});

// ==========================================
// SPA NAVIGATION LOADING SYSTEM
// ==========================================
navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;

    navLinks.forEach(l => l.classList.remove('active'));
    link.classList.add('active');

    // Close mobile side drawer if open
    sidebar.classList.remove('mobile-open');
    sidebarOverlay.classList.add('hidden');

    loadPage(page);
  });
});

function loadPage(page) {
  currentActivePage = page;
  updateFABVisibility();

  pageSections.forEach(section => {
    if (section.id === `page-${page}`) {
      section.classList.remove('hidden');
    } else {
      section.classList.add('hidden');
    }
  });

  // Pull databases dynamically
  if (page === 'dashboard') loadDashboardStats();
  else if (page === 'vehicles') loadVehicles();
  else if (page === 'drivers') loadDrivers();
  else if (page === 'trips') loadTrips();
  else if (page === 'maintenance') loadMaintenance();
  else if (page === 'finance') loadFinance();
  else if (page === 'audit') loadAuditLogs();
  else if (page === 'users') loadUsers();
}

// ==========================================
// DATA RETRIEVAL & RENDERING ENGINES
// ==========================================

async function loadDashboardStats() {
  try {
    const vehicleType = document.getElementById('dash-filter-type')?.value || '';
    const region = document.getElementById('dash-filter-region')?.value || '';
    const status = document.getElementById('dash-filter-status')?.value || '';

    // Construct query parameters
    const params = new URLSearchParams();
    if (vehicleType) params.append('vehicleType', vehicleType);
    if (region) params.append('region', region);
    if (status) params.append('status', status);

    const res = await fetchAPI(`/api/dashboard/stats?${params.toString()}`);
    if (res && res.status === 'success') {
      const kpis = res.data.kpis;
      
      const activeVehiclesEl = document.getElementById('dash-active-vehicles');
      const availVehiclesEl = document.getElementById('dash-avail-vehicles');
      const maintVehiclesEl = document.getElementById('dash-maint-vehicles');
      const activeTripsEl = document.getElementById('dash-active-trips');
      const pendingTripsEl = document.getElementById('dash-pending-trips');
      const driversDutyEl = document.getElementById('dash-drivers-duty');
      const utilizationEl = document.getElementById('dash-utilization');
      const fuelCostsEl = document.getElementById('dash-fuel-costs');

      if (activeVehiclesEl) activeVehiclesEl.textContent = kpis.activeVehicles;
      if (availVehiclesEl) availVehiclesEl.textContent = kpis.availableVehicles;
      if (maintVehiclesEl) maintVehiclesEl.textContent = kpis.maintenanceVehicles;
      if (activeTripsEl) activeTripsEl.textContent = kpis.activeTrips;
      if (pendingTripsEl) pendingTripsEl.textContent = kpis.pendingTrips;
      if (driversDutyEl) driversDutyEl.textContent = kpis.driversOnDuty;
      if (utilizationEl) utilizationEl.textContent = `${kpis.fleetUtilization}%`;
      if (fuelCostsEl) fuelCostsEl.textContent = `$${kpis.totalFuelCost.toLocaleString()}`;
    }
  } catch (err) {
    console.error('Failed to load dashboard statistics:', err);
  }
}

async function loadVehicles() {
  const container = document.getElementById('vehicles-list');
  container.innerHTML = '<tr><td colspan="7" class="empty-message">Loading Fleet registry...</td></tr>';

  try {
    const searchVal = document.getElementById('vehicles-search')?.value || '';
    const statusVal = document.getElementById('vehicles-filter-status')?.value || '';
    
    let url = '/api/vehicles?limit=100';
    if (searchVal) {
      url += `&search=${encodeURIComponent(searchVal)}`;
    }
    if (statusVal) {
      url += `&status=${encodeURIComponent(statusVal)}`;
    }

    const res = await fetchAPI(url);
    container.innerHTML = '';

    if (res.data.vehicles.length === 0) {
      container.innerHTML = '<tr><td colspan="7" class="empty-message">No matching vehicles recorded.</td></tr>';
      return;
    }

    const hasActions = can('update', 'Vehicle') || can('retire', 'Vehicle') || can('sell', 'Vehicle');
    const actionsHeader = document.querySelector('#vehicles-table th:last-child');
    if (actionsHeader) {
      if (hasActions) actionsHeader.classList.remove('hidden');
      else actionsHeader.classList.add('hidden');
    }

    res.data.vehicles.forEach(vehicle => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:40px; height:40px; border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.05); border:1px solid var(--border-color); flex-shrink:0;">
              <img src="${vehicle.photoUrl || DEFAULT_VEHICLE_PHOTO}" style="width:100%; height:100%; object-fit:cover;">
            </div>
            <a href="#" class="vehicle-history-link" data-id="${vehicle._id}" style="color:var(--accent); font-weight:700; text-decoration:none;">${vehicle.registrationNumber}</a>
          </div>
        </td>
        <td>${vehicle.make} ${vehicle.modelName}</td>
        <td>${vehicle.capacityKg.toLocaleString()} Kg</td>
        <td>
          Bought: ${vehicle.purchasePrice ? `$${vehicle.purchasePrice.toLocaleString()}` : '—'}
          ${vehicle.status === 'Sold' ? `<br><span style="color:var(--danger)">Sold: $${vehicle.sellingPrice ? vehicle.sellingPrice.toLocaleString() : '—'}</span>` : ''}
        </td>
        <td>—</td>
        <td><span class="badge status-${vehicle.status.replace(' ', '-')}">${vehicle.status}</span></td>
        ${hasActions ? `
        <td>
          ${vehicle.status === 'Sold' ? '—' : `
            ${vehicle.status === 'Retired' ? `
              ${can('sell', 'Vehicle') ? `<button class="btn btn-primary sell-vehicle-btn" data-id="${vehicle._id}" style="padding:4px 8px; font-size:11px; background:#10B981; border-color:#10B981;">Sell</button>` : '—'}
            ` : `
              ${can('update', 'Vehicle') ? `<button class="btn btn-outline edit-vehicle-btn" data-id="${vehicle._id}" style="padding:4px 8px; font-size:11px;">Edit</button>` : ''}
            `}
          `}
        </td>
        ` : ''}
      `;
      container.appendChild(row);
    });

    document.querySelectorAll('.sell-vehicle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        renderSellVehicleForm(btn.dataset.id);
      });
    });

    document.querySelectorAll('.edit-vehicle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        renderEditVehicleForm(btn.dataset.id);
      });
    });

    document.querySelectorAll('.vehicle-history-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = `vehicle-history.html?id=${link.dataset.id}`;
      });
    });
  } catch (err) {}
}

let selectedDriverId = null;

function showDriverDetailsModal(driver) {
  modalContainer.classList.remove('hidden');
  modalTitle.textContent = `Driver Profile: ${driver.name}`;
  
  let expiryStr = '—';
  let isExpired = false;
  if (driver.licenseExpiry) {
    const expDate = new Date(driver.licenseExpiry);
    expiryStr = expDate.toLocaleDateString();
    if (expDate < new Date()) {
      isExpired = true;
    }
  }

  const initials = driver.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  const category = driver.licenseCategory || 'LMV';
  const tripComp = driver.tripCompletionRate !== undefined ? `${driver.tripCompletionRate}%` : '100%';

  const isExpiredLicense = isExpired;
  const isSuspendedOrFired = driver.status === 'Suspended' || driver.status === 'Fired';
  const isOnLeave = driver.status === 'On Leave';
  const isBlocked = isSuspendedOrFired || isOnLeave || isExpiredLicense;
  const canUpdate = can('update', 'Driver');

  let leaveDaysLeft = 0;
  if (isOnLeave && driver.leaveUntil) {
    const msLeft = new Date(driver.leaveUntil) - new Date();
    leaveDaysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  }

  let leaveInfoHTML = '';
  if (isOnLeave) {
    const startDateStr = driver.leaveStart ? new Date(driver.leaveStart).toLocaleDateString() : 'N/A';
    const returnTimeStr = driver.leaveUntil ? new Date(driver.leaveUntil).toLocaleString() : 'N/A';
    const reasonStr = driver.leaveReason || 'Not specified';
    leaveInfoHTML = `
      <div style="grid-column: 1 / -1; border-top: 1px dashed var(--border-color); padding-top: 12px; margin-top: 10px; font-family: var(--font-family);">
        <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">Leave Information</label>
        <div style="font-size: 13px; color: var(--warning); line-height: 1.6;">
          🗓️ <strong>Started:</strong> ${startDateStr}<br>
          🏁 <strong>Return to Duty:</strong> ${returnTimeStr}<br>
          📝 <strong>Reason:</strong> <em>"${reasonStr}"</em>
        </div>
      </div>
    `;
  }

  modalBody.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 20px; font-family: var(--font-family); color: var(--text-main);">
      <div style="display: flex; align-items: center; gap: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 20px;">
        ${driver.photo ? `
          <img src="${driver.photo}" style="width: 70px; height: 70px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border-color);" alt="${driver.name}">
        ` : `
          <div style="width: 70px; height: 70px; border-radius: 50%; background-color: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; border: 2px solid var(--border-color); text-transform: uppercase;">
            ${initials}
          </div>
        `}
        <div>
          <h2 style="font-size: 20px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;">${driver.name}</h2>
          <span class="badge status-${driver.status.replace(' ', '-')}">${driver.status}</span>
          ${isOnLeave ? `<span style="font-size: 12.5px; color: var(--warning); font-weight: 600; margin-left: 10px;"><i class="fa-solid fa-clock"></i> ${leaveDaysLeft} day(s) left</span>` : ''}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;">
        <div>
          <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">License Number</label>
          <span style="font-size: 14.5px; font-weight: 600;">${driver.licenseNumber}</span>
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">License Category</label>
          <span style="font-size: 14.5px; font-weight: 600;">${category}</span>
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">Expiry Date</label>
          <span style="font-size: 14.5px; font-weight: 600; color: ${isExpired ? 'var(--danger)' : 'var(--text-main)'};">
            ${expiryStr} ${isExpired ? '<span class="license-expired-badge" style="margin-left: 8px;">EXPIRED</span>' : ''}
          </span>
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">Contact Phone</label>
          <span style="font-size: 14.5px; font-weight: 600;">${driver.phone}</span>
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">Safety Rating</label>
          <span style="font-size: 14.5px; font-weight: 600; display: flex; align-items: center; gap: 4px;">
            ⭐ ${driver.safetyScore} / 100
          </span>
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">Trip Completion Rate</label>
          <span style="font-size: 14.5px; font-weight: 600;">${tripComp}</span>
        </div>
        ${leaveInfoHTML}
      </div>

      <div id="modal-actions-container" style="display: flex; gap: 10px; margin-top: 30px; border-top: 1px solid var(--border-color); padding-top: 20px; flex-wrap: wrap; width: 100%;">
        ${canUpdate ? `
          ${isBlocked ? `
            ${isOnLeave ? `
              <button class="btn btn-primary cancel-leave-btn" style="background-color: var(--success); border-color: var(--success); flex: 1; min-width: 120px; font-weight: 600;">
                <i class="fa-solid fa-plane-arrival"></i> Cancel Leave (Make Available)
              </button>
            ` : driver.status === 'Fired' ? `
              <button class="btn btn-primary unblock-driver-btn" style="background-color: var(--success); border-color: var(--success); flex: 1; min-width: 120px; font-weight: 600;">
                <i class="fa-solid fa-user-plus"></i> Unfire Driver
              </button>
            ` : `
              <button class="btn btn-primary unblock-driver-btn" style="background-color: var(--success); border-color: var(--success); flex: 1; min-width: 120px; font-weight: 600;">
                <i class="fa-solid fa-unlock"></i> Unblock Driver
              </button>
            `}
          ` : `
            <button class="btn btn-logout block-driver-btn" style="flex: 1; min-width: 120px; font-weight: 600;">
              <i class="fa-solid fa-ban"></i> Block Driver
            </button>
            <button class="btn btn-outline leave-driver-btn" style="background-color: var(--warning-glow); color: var(--warning); border-color: rgba(245, 158, 11, 0.3); flex: 1; min-width: 120px; font-weight: 600;">
              <i class="fa-solid fa-plane-departure"></i> Put on Leave
            </button>
            <button class="btn btn-logout fire-driver-btn" style="background-color: var(--danger); border-color: var(--danger); color: #fff; flex: 1; min-width: 120px; font-weight: 600;">
              <i class="fa-solid fa-user-minus"></i> Fire Driver
            </button>
          `}
        ` : '<span style="color: var(--text-secondary); font-size: 12px; font-style: italic;">Read-Only permissions. You cannot perform actions on this driver.</span>'}
      </div>
    </div>
  `;

  // Wire events
  const actionsContainer = modalBody.querySelector('#modal-actions-container');
  const unblockBtn = modalBody.querySelector('.unblock-driver-btn');
  const cancelLeaveBtn = modalBody.querySelector('.cancel-leave-btn');
  const blockBtn = modalBody.querySelector('.block-driver-btn');
  const leaveBtn = modalBody.querySelector('.leave-driver-btn');
  const fireBtn = modalBody.querySelector('.fire-driver-btn');

  if (unblockBtn) {
    unblockBtn.addEventListener('click', async () => {
      const payload = { leaveStart: null, leaveDays: null, leaveReason: null, leaveUntil: null };
      if (driver.status === 'Suspended' || driver.status === 'Fired') {
        payload.status = 'Available';
      }
      if (isExpired) {
        // Extend license expiry date by 1 year from today
        const oneYearFromNow = new Date();
        oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
        payload.licenseExpiry = oneYearFromNow.toISOString();
      }
      try {
        await fetchAPI(`/api/drivers/${driver._id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        showToast(driver.status === 'Fired' ? 'Driver unfired successfully!' : 'Driver unblocked successfully!');
        modalContainer.classList.add('hidden');
        loadDrivers();
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (cancelLeaveBtn) {
    cancelLeaveBtn.addEventListener('click', async () => {
      try {
        await fetchAPI(`/api/drivers/${driver._id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'Available',
            leaveStart: null,
            leaveDays: null,
            leaveReason: null,
            leaveUntil: null
          })
        });
        showToast('Leave cancelled. Driver is now Available.');
        modalContainer.classList.add('hidden');
        loadDrivers();
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (blockBtn) {
    blockBtn.addEventListener('click', async () => {
      try {
        await fetchAPI(`/api/drivers/${driver._id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Suspended' })
        });
        showToast('Driver blocked (suspended) successfully.');
        modalContainer.classList.add('hidden');
        loadDrivers();
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      // Render Leave Form instead of native prompt popup
      actionsContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 15px; width: 100%; font-family: var(--font-family);">
          <h3 style="font-size: 14px; font-weight: 700; color: var(--text-main); margin-bottom: 5px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">Configure Leave Details</h3>
          <div style="display: flex; gap: 15px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 140px;">
              <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 5px;">Start Date</label>
              <input type="date" id="leave-start-input" required class="input-filter" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--radius-sm);" value="${new Date().toISOString().substring(0, 10)}">
            </div>
            <div style="flex: 1; min-width: 140px;">
              <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 5px;">End Date</label>
              <input type="date" id="leave-end-input" required class="input-filter" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--radius-sm);" value="${new Date(Date.now() + 7*24*60*60*1000).toISOString().substring(0, 10)}">
            </div>
            <div style="flex: 1; min-width: 140px;">
              <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 5px;">Duty Return Time</label>
              <input type="time" id="leave-time-input" required class="input-filter" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--radius-sm);" value="08:00">
            </div>
          </div>
          <div>
            <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 5px;">Reason for Leave</label>
            <input type="text" id="leave-reason-input" required class="input-filter" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--radius-sm);" placeholder="e.g., Medical reasons, Annual holiday, Family event">
          </div>
          <div style="display: flex; gap: 10px; margin-top: 10px;">
            <button type="button" class="btn btn-primary confirm-leave-form-btn" style="background-color: var(--success); border-color: var(--success); flex: 1; font-weight: 600;">Confirm Leave</button>
            <button type="button" class="btn btn-outline cancel-leave-form-btn" style="flex: 1; font-weight: 600;">Cancel</button>
          </div>
        </div>
      `;

      // Wire leave form buttons
      actionsContainer.querySelector('.cancel-leave-form-btn').addEventListener('click', () => {
        showDriverDetailsModal(driver);
      });

      actionsContainer.querySelector('.confirm-leave-form-btn').addEventListener('click', async () => {
        const leaveStartVal = document.getElementById('leave-start-input').value;
        const leaveEndVal = document.getElementById('leave-end-input').value;
        const leaveTimeVal = document.getElementById('leave-time-input').value || '08:00';
        const leaveReasonVal = document.getElementById('leave-reason-input').value.trim();

        if (!leaveStartVal) {
          showToast('Please specify a start date.', 'error');
          return;
        }
        if (!leaveEndVal) {
          showToast('Please specify an end date.', 'error');
          return;
        }
        if (!leaveReasonVal) {
          showToast('Please specify a reason for leave.', 'error');
          return;
        }

        const startParsed = new Date(leaveStartVal + 'T00:00:00');
        const leaveUntilDate = new Date(leaveEndVal + 'T' + leaveTimeVal);

        if (leaveUntilDate <= startParsed) {
          showToast('End date and time must be after the start date.', 'error');
          return;
        }

        const diffTime = leaveUntilDate - startParsed;
        const leaveDaysVal = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

        try {
          await fetchAPI(`/api/drivers/${driver._id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: 'On Leave',
              leaveStart: startParsed.toISOString(),
              leaveDays: leaveDaysVal,
              leaveReason: leaveReasonVal,
              leaveUntil: leaveUntilDate.toISOString()
            })
          });
          showToast(`Driver put on leave until ${leaveUntilDate.toLocaleString()} (${leaveDaysVal} days).`);
          modalContainer.classList.add('hidden');
          loadDrivers();
        } catch (err) {
          console.error(err);
        }
      });
    });
  }

  if (fireBtn) {
    fireBtn.addEventListener('click', () => {
      // Render Fire Confirmation Panel instead of native confirm dialog
      actionsContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 15px; width: 100%; font-family: var(--font-family); text-align: center; border-top: 1px solid var(--border-color); padding-top: 15px;">
          <h3 style="font-size: 14px; font-weight: 700; color: var(--danger); margin-bottom: 5px;">Fire Driver from Duty</h3>
          <p style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.4;">
            Are you sure you want to change <strong>${driver.name}</strong>'s status to <strong>Fired</strong>?<br>
            This driver will be permanently blocked from all vehicle and trip duties.
          </p>
          <div style="display: flex; gap: 10px; margin-top: 10px; justify-content: center; width: 100%;">
            <button type="button" class="btn btn-logout confirm-fire-form-btn" style="background-color: var(--danger); border-color: var(--danger); color: #fff; flex: 1; font-weight: 600;">Confirm Terminate</button>
            <button type="button" class="btn btn-outline cancel-fire-form-btn" style="flex: 1; font-weight: 600;">Cancel</button>
          </div>
        </div>
      `;

      // Wire fire confirmation buttons
      actionsContainer.querySelector('.cancel-fire-form-btn').addEventListener('click', () => {
        showDriverDetailsModal(driver);
      });

      actionsContainer.querySelector('.confirm-fire-form-btn').addEventListener('click', async () => {
        try {
          await fetchAPI(`/api/drivers/${driver._id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Fired' })
          });
          showToast('Driver status successfully set to Fired.');
          modalContainer.classList.add('hidden');
          loadDrivers();
        } catch (err) {
          console.error(err);
        }
      });
    });
  }
}

async function loadDrivers() {
  const container = document.getElementById('drivers-list-tbody');
  if (!container) return;
  container.innerHTML = '<tr><td colspan="8" class="empty-message">Loading Drivers...</td></tr>';

  // Clear selection state when reloading
  selectedDriverId = null;
  document.querySelectorAll('#drivers-table tbody tr').forEach(r => r.classList.remove('selected'));

  try {
    const searchVal = document.getElementById('drivers-search')?.value || '';
    let url = '/api/drivers';
    if (searchVal) {
      url += `?search=${encodeURIComponent(searchVal)}`;
    }
    const res = await fetchAPI(url);
    container.innerHTML = '';

    if (!res || !res.data || !res.data.drivers || res.data.drivers.length === 0) {
      container.innerHTML = '<tr><td colspan="8" class="empty-message">No registered drivers.</td></tr>';
      return;
    }

    res.data.drivers.forEach(driver => {
      const row = document.createElement('tr');
      row.dataset.id = driver._id;

      // Expiry format
      let expiryStr = '—';
      let isExpired = false;
      if (driver.licenseExpiry) {
        const expDate = new Date(driver.licenseExpiry);
        const mm = String(expDate.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = expDate.getUTCFullYear();
        expiryStr = `${mm}/${yyyy}`;
        if (expDate < new Date()) {
          isExpired = true;
        }
      }

      // Contact format: +1987650000 -> 98765xxxxx
      let contactStr = driver.phone || '—';
      if (contactStr !== '—') {
        const digits = contactStr.replace(/\D/g, '');
        if (digits.length >= 5) {
          contactStr = digits.substring(0, 5) + 'xxxxx';
        } else {
          contactStr = digits + 'xxxxx';
        }
      }

      const category = driver.licenseCategory || 'LMV';
      const tripComp = driver.tripCompletionRate !== undefined ? `${driver.tripCompletionRate}%` : '100%';

      const safetyState = (driver.status === 'Suspended' || driver.status === 'Fired' || driver.status === 'On Leave') ? driver.status : (driver.status === 'On Trip' ? 'On Trip' : 'Available');
      const statusState = driver.status;

      const initials = driver.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

      row.innerHTML = `
        <td style="display: flex; align-items: center; gap: 10px;">
          ${driver.photo ? `
            <img src="${driver.photo}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(124, 58, 237, 0.2); flex-shrink: 0;" alt="${driver.name}">
          ` : `
            <div class="driver-dp" style="width: 32px; height: 32px; border-radius: 50%; background-color: var(--accent-glow); color: var(--accent-hover); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; text-transform: uppercase; border: 1px solid rgba(124, 58, 237, 0.2); flex-shrink: 0;">
              ${initials}
            </div>
          `}
          <strong class="driver-name-link" style="color: var(--accent-hover); text-decoration: underline; cursor: pointer;">${driver.name}</strong>
        </td>
        <td>${driver.licenseNumber}</td>
        <td>${category}</td>
        <td>${expiryStr}${isExpired ? '<span class="license-expired-badge">EXPIRED</span>' : ''}</td>
        <td>${contactStr}</td>
        <td>${tripComp}</td>
        <td><span class="badge status-${safetyState.replace(' ', '-')}">${safetyState}</span></td>
        <td><span class="badge status-${statusState.replace(' ', '-')}">${statusState}</span></td>
      `;

      // Click on name displays details modal
      row.querySelector('.driver-name-link').addEventListener('click', (e) => {
        e.stopPropagation();
        showDriverDetailsModal(driver);
      });

      row.addEventListener('click', (e) => {
        document.querySelectorAll('#drivers-table tbody tr').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        selectedDriverId = driver._id;
      });

      container.appendChild(row);
    });
  } catch (err) {
    console.error(err);
  }
}


async function loadTrips() {
  const container = document.getElementById('trips-list');
  container.innerHTML = '<div class="empty-message" style="grid-column: 1/-1;">Loading Trips...</div>';

  try {
    const res = await fetchAPI('/api/trips');
    container.innerHTML = '';

    if (res.data.trips.length === 0) {
      container.innerHTML = '<div class="empty-message" style="grid-column: 1/-1;">No trips scheduled.</div>';
      return;
    }

    res.data.trips.forEach(trip => {
      const card = document.createElement('div');
      card.className = 'trip-card glass';
      
      const isDraft = trip.status === 'Draft';
      const isDispatched = trip.status === 'Dispatched';
      const isCompleted = trip.status === 'Completed';

      // Determine timeline node states
      const dispatchDone = isDispatched || isCompleted;
      
      card.innerHTML = `
        <div class="trip-card-header">
          <span class="badge status-${trip.status}">${trip.status}</span>
          <span style="font-size:11px; color:var(--text-secondary);">Weight: <strong>${trip.cargoWeightKg.toLocaleString()} Kg</strong></span>
        </div>
        <div class="route-desc">
          <strong>${trip.source}</strong>
          <i class="fa-solid fa-arrow-right-long"></i>
          <strong>${trip.destination}</strong>
        </div>
        <div class="trip-card-details">
          <p class="detail-line">Distance: <strong>${trip.distanceKm} Km</strong></p>
          <p class="detail-line">Driver: <strong>${trip.driver?.name || 'Unassigned'}</strong></p>
          <p class="detail-line">Vehicle: <strong>${trip.vehicle?.registrationNumber || 'Unassigned'}</strong></p>
          <p class="detail-line">Cargo: <strong>${trip.cargoDescription}</strong></p>
        </div>

        <div class="timeline-tracker">
          <div class="timeline-node done">
            <div class="node-dot"><i class="fa-solid fa-check"></i></div>
            <span class="node-label">Created</span>
          </div>
          <div class="timeline-node ${dispatchDone ? 'done' : 'active'}">
            <div class="node-dot">${dispatchDone ? '<i class="fa-solid fa-check"></i>' : '2'}</div>
            <span class="node-label">Assigned</span>
          </div>
          <div class="timeline-node ${isCompleted ? 'done' : isDispatched ? 'active' : ''}">
            <div class="node-dot">${isCompleted ? '<i class="fa-solid fa-check"></i>' : '3'}</div>
            <span class="node-label">Dispatched</span>
          </div>
          <div class="timeline-node ${isCompleted ? 'done' : ''}">
            <div class="node-dot">${isCompleted ? '<i class="fa-solid fa-check"></i>' : '4'}</div>
            <span class="node-label">Delivered</span>
          </div>
        </div>

        <div style="display:flex; gap:10px;">
          ${isDraft && can('dispatch', 'Trip') ? `<button class="btn btn-primary btn-block dispatch-btn" data-id="${trip._id}">Dispatch</button>` : ''}
          ${isDispatched && can('complete', 'Trip') ? `<button class="btn btn-outline btn-block complete-btn" data-id="${trip._id}" style="color:var(--success);">Complete</button>` : ''}
          ${(isDraft || isDispatched) && can('cancel', 'Trip') ? `<button class="btn btn-logout btn-block cancel-btn" data-id="${trip._id}">Cancel</button>` : ''}
          <button class="btn btn-outline track-btn" data-id="${trip._id}"><i class="fa-solid fa-location-crosshairs"></i> Track</button>
        </div>
      `;
      container.appendChild(card);
    });

  } catch (err) {}
}

async function loadFinance() {
  loadExpenses();
  loadFuelLogs();
}

async function loadCostSummary() {
  const container = document.getElementById('cost-summary-container');
  if (!container) return;
  container.innerHTML = '<div class="empty-message">Computing operational costs...</div>';

  try {
    // Fetch all fuel logs and expenses (high limit to get all records)
    const [fuelRes, expRes] = await Promise.all([
      fetchAPI('/api/expenses/fuel?limit=1000'),
      fetchAPI('/api/expenses?limit=1000'),
    ]);

    const fuelLogs = fuelRes?.data?.fuelLogs || [];
    const expenses = expRes?.data?.expenses || [];

    // Aggregate per vehicle
    const vehicleMap = {};

    fuelLogs.forEach(f => {
      const id  = f.vehicle?._id || f.vehicle;
      const reg = f.vehicle?.registrationNumber || id;
      const make = `${f.vehicle?.make || ''} ${f.vehicle?.modelName || ''}`.trim();
      if (!vehicleMap[id]) vehicleMap[id] = { reg, make, fuelCost: 0, fuelLiters: 0, expenseCost: 0, expenseCount: 0 };
      vehicleMap[id].fuelCost   += f.cost || 0;
      vehicleMap[id].fuelLiters += f.fuelLiters || 0;
    });

    expenses.forEach(e => {
      const id  = e.vehicle?._id || e.vehicle;
      const reg = e.vehicle?.registrationNumber || id;
      const make = `${e.vehicle?.make || ''} ${e.vehicle?.modelName || ''}`.trim();
      if (!vehicleMap[id]) vehicleMap[id] = { reg, make, fuelCost: 0, fuelLiters: 0, expenseCost: 0, expenseCount: 0 };
      vehicleMap[id].expenseCost  += e.amount || 0;
      vehicleMap[id].expenseCount += 1;
    });

    const vehicles = Object.values(vehicleMap);

    if (vehicles.length === 0) {
      container.innerHTML = '<div class="empty-message">No cost data available yet. Add fuel logs or expenses first.</div>';
      return;
    }

    container.innerHTML = '';

    // Grand totals row
    const grandFuel    = vehicles.reduce((s, v) => s + v.fuelCost, 0);
    const grandExpense = vehicles.reduce((s, v) => s + v.expenseCost, 0);
    const grandTotal   = grandFuel + grandExpense;

    const summaryBanner = document.createElement('div');
    summaryBanner.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:8px;';
    summaryBanner.innerHTML = `
      <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:20px;text-align:center;">
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;"><i class="fa-solid fa-gas-pump"></i> Total Fuel Cost</div>
        <div style="font-size:26px;font-weight:800;color:var(--warning);">$ ${grandFuel.toLocaleString()}</div>
      </div>
      <div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:20px;text-align:center;">
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;"><i class="fa-solid fa-receipt"></i> Total Other Expenses</div>
        <div style="font-size:26px;font-weight:800;color:var(--accent-hover);">$ ${grandExpense.toLocaleString()}</div>
      </div>
      <div style="background:linear-gradient(135deg,var(--accent),#4f1ea8);border:1px solid var(--accent);border-radius:var(--radius-md);padding:20px;text-align:center;box-shadow:var(--shadow-glow);">
        <div style="font-size:11px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;"><i class="fa-solid fa-coins"></i> Grand Operational Total</div>
        <div style="font-size:26px;font-weight:800;color:#fff;">$ ${grandTotal.toLocaleString()}</div>
      </div>
    `;
    container.appendChild(summaryBanner);

    // Per-vehicle breakdown heading
    const heading = document.createElement('h3');
    heading.style.cssText = 'font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-secondary);margin:12px 0 8px;';
    heading.innerHTML = '<i class="fa-solid fa-truck"></i>&nbsp; Per-Vehicle Breakdown';
    container.appendChild(heading);

    // Per-vehicle cards
    vehicles.forEach(v => {
      const total = v.fuelCost + v.expenseCost;
      const fuelPct = total > 0 ? Math.round((v.fuelCost / total) * 100) : 0;
      const expPct  = 100 - fuelPct;

      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:20px;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;';
      card.innerHTML = `
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <span style="font-size:18px;">🚛</span>
            <div>
              <div style="font-size:15px;font-weight:700;color:var(--text-main);">${v.reg}</div>
              <div style="font-size:12px;color:var(--text-secondary);">${v.make}</div>
            </div>
          </div>
          <div style="display:flex;gap:24px;flex-wrap:wrap;">
            <div>
              <div style="font-size:11px;color:var(--text-secondary);"><i class="fa-solid fa-gas-pump"></i> Fuel Cost</div>
              <div style="font-size:16px;font-weight:700;color:var(--warning);">$ ${v.fuelCost.toLocaleString()}</div>
              <div style="font-size:10px;color:var(--text-secondary);">${v.fuelLiters.toLocaleString()} Liters</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-secondary);"><i class="fa-solid fa-receipt"></i> Expenses</div>
              <div style="font-size:16px;font-weight:700;color:var(--accent-hover);">$ ${v.expenseCost.toLocaleString()}</div>
              <div style="font-size:10px;color:var(--text-secondary);">${v.expenseCount} record${v.expenseCount !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <!-- Cost bar -->
          <div style="margin-top:14px;background:var(--bg-card);border-radius:99px;height:8px;overflow:hidden;">
            <div style="display:flex;height:100%;">
              <div style="width:${fuelPct}%;background:var(--warning);border-radius:99px 0 0 99px;"></div>
              <div style="width:${expPct}%;background:var(--accent);border-radius:0 99px 99px 0;"></div>
            </div>
          </div>
          <div style="display:flex;gap:12px;margin-top:4px;font-size:10px;color:var(--text-secondary);">
            <span><span style="color:var(--warning);">&#9632;</span> Fuel ${fuelPct}%</span>
            <span><span style="color:var(--accent);">&#9632;</span> Other ${expPct}%</span>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Total Cost</div>
          <div style="font-size:28px;font-weight:800;color:var(--success);">$${total.toLocaleString()}</div>
        </div>
      `;
      container.appendChild(card);
    });

  } catch (err) {
    container.innerHTML = '<div class="empty-message" style="color:var(--danger);">Failed to load cost data.</div>';
  }
}

async function loadExpenses() {
  const container = document.getElementById('expenses-list');
  container.innerHTML = '<tr><td colspan="7" class="empty-message">Loading Invoices...</td></tr>';

  try {
    const res = await fetchAPI('/api/expenses');
    container.innerHTML = '';

    if (res.data.expenses.length === 0) {
      container.innerHTML = '<tr><td colspan="7" class="empty-message">No expenses.</td></tr>';
      return;
    }

    const hasActions = can('approve', 'Expense');
    const actionsHeader = document.querySelector('#expenses-table th:last-child');
    if (actionsHeader) {
      if (hasActions) actionsHeader.classList.remove('hidden');
      else actionsHeader.classList.add('hidden');
    }

    res.data.expenses.forEach(exp => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${exp.expenseType}</strong></td>
        <td>$ ${exp.amount.toLocaleString()}</td>
        <td>${new Date(exp.date).toLocaleDateString()}</td>
        <td>${exp.vehicle?.registrationNumber || 'N/A'}</td>
        <td>${exp.description || '—'}</td>
        <td><span class="badge status-${exp.status}">${exp.status}</span></td>
        ${hasActions ? `
        <td>
          ${exp.status === 'Pending' ? `<button class="btn btn-primary approve-exp-btn" data-id="${exp._id}" style="padding:4px 8px; font-size:11px;">Approve</button>` : '—'}
        </td>
        ` : ''}
      `;
      container.appendChild(row);
    });

    document.querySelectorAll('.approve-exp-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetchAPI(`/api/expenses/${btn.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Approved' })
        });
        showToast('Expense Approved.');
        loadExpenses();
      });
    });
  } catch (err) {}
}

async function loadFuelLogs() {
  const container = document.getElementById('fuel-list');
  container.innerHTML = '<tr><td colspan="5" class="empty-message">Loading Fuel fill records...</td></tr>';

  try {
    const res = await fetchAPI('/api/expenses/fuel');
    container.innerHTML = '';

    if (res.data.fuelLogs.length === 0) {
      container.innerHTML = '<tr><td colspan="5" class="empty-message">No fuel logs found.</td></tr>';
      return;
    }

    res.data.fuelLogs.forEach(log => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${log.vehicle?.registrationNumber || 'Unknown'}</strong></td>
        <td>${new Date(log.date).toLocaleDateString()}</td>
        <td>${log.fuelLiters} Liters</td>
        <td>$ ${log.cost.toLocaleString()}</td>
        <td>📟 ${log.odometer.toLocaleString()} Km</td>
      `;
      container.appendChild(row);
    });
  } catch (err) {}
}

async function loadMaintenance() {
  const container = document.getElementById('maintenance-list');
  container.innerHTML = '<tr><td colspan="5" class="empty-message">Loading Repairs...</td></tr>';

  try {
    const res = await fetchAPI('/api/maintenance');
    container.innerHTML = '';

    if (res.data.logs.length === 0) {
      container.innerHTML = '<tr><td colspan="5" class="empty-message">No active workshop records.</td></tr>';
      return;
    }

    const hasActions = can('close', 'Maintenance');
    const actionsHeader = document.querySelector('#maintenance-table th:last-child');
    if (actionsHeader) {
      if (hasActions) actionsHeader.classList.remove('hidden');
      else actionsHeader.classList.add('hidden');
    }

    res.data.logs.forEach(log => {
      const row = document.createElement('tr');
      const isActive = log.status === 'Active';
      row.innerHTML = `
        <td><strong>${log.vehicle?.registrationNumber || 'Unknown'}</strong></td>
        <td>${log.description}</td>
        <td>$ ${log.cost.toLocaleString()}</td>
        <td><span class="badge status-${log.status}">${log.status}</span></td>
        ${hasActions ? `
        <td>
          ${isActive ? `<button class="btn btn-outline close-repair-btn" data-id="${log._id}" style="padding:4px 8px; font-size:11px; color:var(--success);">Close Repair</button>` : '—'}
        </td>
        ` : ''}
      `;
      container.appendChild(row);
    });

    document.querySelectorAll('.close-repair-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetchAPI(`/api/maintenance/${btn.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Closed' })
        });
        showToast('Repair closed. Vehicle released.');
        loadMaintenance();
      });
    });
  } catch (err) {}
}

async function loadAuditLogs() {
  const container = document.getElementById('audit-list');
  container.innerHTML = '<tr><td colspan="6" class="empty-message">Loading Security logs...</td></tr>';

  try {
    const res = await fetchAPI('/api/users/audit');
    container.innerHTML = '';

    if (res.data.logs.length === 0) {
      container.innerHTML = '<tr><td colspan="6" class="empty-message">No audit trails recorded.</td></tr>';
      return;
    }

    res.data.logs.forEach(log => {
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

async function loadUsers() {
  const container = document.getElementById('users-list');
  container.innerHTML = '<tr><td colspan="6" class="empty-message">Loading users...</td></tr>';

  try {
    const res = await fetchAPI('/api/users');
    container.innerHTML = '';

    res.data.users.forEach(user => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><span class="avatar">👤</span></td>
        <td><strong>${user.name}</strong></td>
        <td>${user.email}</td>
        <td><span class="badge status-On-Trip">${user.role.replace('_', ' ')}</span></td>
        <td><span class="badge ${user.isActive ? 'status-Available' : 'status-Retired'}">${user.isActive ? 'Active' : 'Locked'}</span></td>
        <td>
          ${user.isActive ? `<button class="btn btn-logout lock-user-btn" data-id="${user._id}" style="padding:4px 8px; font-size:11px;">Lock Account</button>` : '—'}
        </td>
      `;
      container.appendChild(row);
    });
  } catch (err) {}
}

// Financial tab button selection triggers
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;
    ['expenses', 'fuel', 'cost-summary'].forEach(t => {
      const el = document.getElementById(`tab-content-${t}`);
      if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(`tab-content-${tab}`);
    if (target) target.classList.remove('hidden');

    // Load cost summary on demand
    if (tab === 'cost-summary') loadCostSummary();
  });
});

// ==========================================
// OUTBOUND LOGOUT COMMANDS
// ==========================================
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}

  accessToken = null;
  currentUser = null;
  if (refreshInterval) clearInterval(refreshInterval);

  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
  loginPasswordInput.value = '';
  showToast('Logged out.', 'info');
}

logoutBtn.addEventListener('click', handleLogout);
profileSignout.addEventListener('click', handleLogout);

// ==========================================
// FLOATING ACTION BUTTON & DYNAMIC MODALS
// ==========================================
modalClose.addEventListener('click', () => {
  modalContainer.classList.add('hidden');
  document.querySelector('.modal-card')?.classList.remove('modal-large');
});

floatingActionBtn.addEventListener('click', () => {
  modalContainer.classList.remove('hidden');
  modalTitle.textContent = currentActivePage === 'vehicles' ? 'Buy New Vehicle' : `Register New ${currentActivePage.charAt(0).toUpperCase() + currentActivePage.slice(1, -1)}`;

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
  }
});

function renderVehicleForm() {
  modalBody.innerHTML = `
    <form id="create-vehicle-form">
      <div class="input-group">
        <input type="text" id="veh-reg" required placeholder=" ">
        <label for="veh-reg"><i class="fa-solid fa-hashtag"></i> Registration Number</label>
      </div>
      <div class="input-group">
        <input type="text" id="veh-make" required placeholder=" ">
        <label for="veh-make"><i class="fa-solid fa-truck"></i> Make</label>
      </div>
      <div class="input-group">
        <input type="text" id="veh-model" required placeholder=" ">
        <label for="veh-model"><i class="fa-solid fa-cube"></i> Model Name</label>
      </div>
      <div class="input-group">
        <input type="number" id="veh-cap" required placeholder=" ">
        <label for="veh-cap"><i class="fa-solid fa-weight-hanging"></i> Capacity (Kg)</label>
      </div>
      <div class="input-group">
        <input type="number" id="veh-purchase-price" required placeholder=" ">
        <label for="veh-purchase-price"><i class="fa-solid fa-dollar-sign"></i> Purchase Price</label>
      </div>
      <div class="input-group">
        <input type="date" id="veh-purchase-date" required placeholder=" ">
        <label for="veh-purchase-date"><i class="fa-solid fa-calendar-days"></i> Purchase Date</label>
      </div>
      <div class="input-group" style="margin-bottom: 24px;">
        <input type="file" id="veh-photo-file" accept="image/*" style="padding: 10px 0;">
        <label for="veh-photo-file" style="position: static; transform: none; font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 6px;">
          <i class="fa-solid fa-image"></i> Vehicle Photo File (Optional)
        </label>
        <div id="create-photo-preview" style="margin-top: 10px; width: 80px; height: 80px; border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03);">
          <img src="${DEFAULT_VEHICLE_PHOTO}" style="width: 100%; height: 100%; object-fit: cover;" id="create-preview-img">
        </div>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Buy & Add Vehicle</button>
    </form>
  `;

  document.getElementById('veh-purchase-date').valueAsDate = new Date();

  const fileInput = document.getElementById('veh-photo-file');
  const previewImg = document.getElementById('create-preview-img');
  
  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      if (file.size > 5 * 1024 * 1024) {
        showToast('Image size cannot exceed 5MB.', 'error');
        fileInput.value = '';
        previewImg.src = DEFAULT_VEHICLE_PHOTO;
        return;
      }
      try {
        const base64 = await toBase64(file);
        previewImg.src = base64;
      } catch (err) {
        console.error(err);
      }
    } else {
      previewImg.src = DEFAULT_VEHICLE_PHOTO;
    }
  });

  document.getElementById('create-vehicle-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      let photoUrl = DEFAULT_VEHICLE_PHOTO;
      if (fileInput.files.length > 0) {
        photoUrl = await toBase64(fileInput.files[0]);
      }

      await fetchAPI('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          registrationNumber: document.getElementById('veh-reg').value,
          make: document.getElementById('veh-make').value,
          modelName: document.getElementById('veh-model').value,
          capacityKg: parseFloat(document.getElementById('veh-cap').value),
          purchasePrice: parseFloat(document.getElementById('veh-purchase-price').value),
          purchaseDate: document.getElementById('veh-purchase-date').value,
          photoUrl: photoUrl,
        }),
      });
      showToast('Vehicle purchased and registered successfully!');
      modalContainer.classList.add('hidden');
      loadVehicles();
    } catch (err) {}
  });
}

async function renderEditVehicleForm(vehicleId) {
  modalContainer.classList.remove('hidden');
  modalTitle.textContent = 'Edit Vehicle Details';
  modalBody.innerHTML = '<div class="empty-message">Loading vehicle details...</div>';

  try {
    const res = await fetchAPI(`/api/vehicles/${vehicleId}`);
    const vehicle = res.data.vehicle;

    modalBody.innerHTML = `
      <form id="edit-vehicle-form">
        <div class="input-group">
          <input type="text" id="edit-veh-reg" required value="${vehicle.registrationNumber || ''}" placeholder=" ">
          <label for="edit-veh-reg"><i class="fa-solid fa-hashtag"></i> Registration Number</label>
        </div>
        <div class="input-group">
          <input type="text" id="edit-veh-make" required value="${vehicle.make || ''}" placeholder=" ">
          <label for="edit-veh-make"><i class="fa-solid fa-truck"></i> Make</label>
        </div>
        <div class="input-group">
          <input type="text" id="edit-veh-model" required value="${vehicle.modelName || ''}" placeholder=" ">
          <label for="edit-veh-model"><i class="fa-solid fa-cube"></i> Model Name</label>
        </div>
        <div class="input-group">
          <input type="number" id="edit-veh-cap" required value="${vehicle.capacityKg || ''}" placeholder=" ">
          <label for="edit-veh-cap"><i class="fa-solid fa-weight-hanging"></i> Capacity (Kg)</label>
        </div>
        <div class="input-group">
          <input type="number" id="edit-veh-purchase-price" value="${vehicle.purchasePrice || ''}" placeholder=" ">
          <label for="edit-veh-purchase-price"><i class="fa-solid fa-dollar-sign"></i> Purchase Price</label>
        </div>
        <div class="input-group">
          <input type="date" id="edit-veh-purchase-date" value="${vehicle.purchaseDate ? vehicle.purchaseDate.substring(0, 10) : ''}" placeholder=" ">
          <label for="edit-veh-purchase-date"><i class="fa-solid fa-calendar-days"></i> Purchase Date</label>
        </div>
        <div class="input-group" style="margin-bottom: 24px;">
          <input type="file" id="edit-veh-photo-file" accept="image/*" style="padding: 10px 0;">
          <label for="edit-veh-photo-file" style="position: static; transform: none; font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 6px;">
            <i class="fa-solid fa-image"></i> Vehicle Photo File (Optional)
          </label>
          <div id="edit-photo-preview" style="margin-top: 10px; width: 80px; height: 80px; border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03);">
            <img src="${vehicle.photoUrl || DEFAULT_VEHICLE_PHOTO}" style="width: 100%; height: 100%; object-fit: cover;" id="edit-preview-img">
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Save Changes</button>
      </form>
    `;

    const fileInput = document.getElementById('edit-veh-photo-file');
    const previewImg = document.getElementById('edit-preview-img');
    
    fileInput.addEventListener('change', async () => {
      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (file.size > 5 * 1024 * 1024) {
          showToast('Image size cannot exceed 5MB.', 'error');
          fileInput.value = '';
          previewImg.src = vehicle.photoUrl || DEFAULT_VEHICLE_PHOTO;
          return;
        }
        try {
          const base64 = await toBase64(file);
          previewImg.src = base64;
        } catch (err) {
          console.error(err);
        }
      } else {
        previewImg.src = vehicle.photoUrl || DEFAULT_VEHICLE_PHOTO;
      }
    });

    document.getElementById('edit-vehicle-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        let photoUrl = vehicle.photoUrl || DEFAULT_VEHICLE_PHOTO;
        if (fileInput.files.length > 0) {
          photoUrl = await toBase64(fileInput.files[0]);
        }

        await fetchAPI(`/api/vehicles/${vehicleId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            registrationNumber: document.getElementById('edit-veh-reg').value,
            make: document.getElementById('edit-veh-make').value,
            modelName: document.getElementById('edit-veh-model').value,
            capacityKg: parseFloat(document.getElementById('edit-veh-cap').value),
            purchasePrice: parseFloat(document.getElementById('edit-veh-purchase-price').value) || undefined,
            purchaseDate: document.getElementById('edit-veh-purchase-date').value || undefined,
            photoUrl: photoUrl,
          }),
        });
        showToast('Vehicle details updated successfully!');
        modalContainer.classList.add('hidden');
        loadVehicles();
      } catch (err) {}
    });
  } catch (err) {
    modalBody.innerHTML = '<div class="empty-message">Failed to load vehicle details.</div>';
  }
}

function renderDriverForm() {
  let photoBase64 = null;

  modalBody.innerHTML = `
    <form id="create-driver-form">
      <div class="input-group">
        <input type="text" id="drv-name" required placeholder=" ">
        <label for="drv-name"><i class="fa-solid fa-user"></i> Driver Full Name</label>
      </div>
      <div class="input-group">
        <input type="text" id="drv-lic" required placeholder=" ">
        <label for="drv-lic"><i class="fa-solid fa-address-card"></i> License Number</label>
      </div>
      <div class="input-group">
        <select id="drv-category" required>
          <option value="LMV" selected>LMV (Light Motor Vehicle)</option>
          <option value="HMV">HMV (Heavy Motor Vehicle)</option>
        </select>
        <label for="drv-category"><i class="fa-solid fa-layer-group"></i> License Category</label>
      </div>
      <div class="input-group">
        <input type="date" id="drv-expiry" required placeholder=" ">
        <label for="drv-expiry"><i class="fa-solid fa-calendar-days"></i> Expiry Date</label>
      </div>
      <div class="input-group">
        <input type="text" id="drv-phone" required placeholder=" ">
        <label for="drv-phone"><i class="fa-solid fa-phone"></i> Phone Number</label>
      </div>
      <div class="input-group">
        <input type="number" id="drv-trip-rate" min="0" max="100" value="100" required placeholder=" ">
        <label for="drv-trip-rate"><i class="fa-solid fa-percent"></i> Trip Completion Rate (%)</label>
      </div>
      <div class="input-group" style="display: flex; flex-direction: column; gap: 8px;">
        <label style="position: static; transform: none; font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; margin-bottom: 5px; display: block;">
          <i class="fa-solid fa-image"></i> Driver Photo
        </label>
        <div style="display: flex; align-items: center; gap: 15px;">
          <button type="button" id="browse-photo-btn" class="btn btn-outline" style="padding: 10px 15px; font-size: 13px; font-weight: 600;">
            <i class="fa-solid fa-folder-open"></i> Browse Photo...
          </button>
          <input type="file" id="drv-photo-file" accept="image/*" style="display: none;">
          <img id="drv-photo-preview" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-color); display: none;" alt="Preview">
        </div>
      </div>
      <button type="submit" class="btn btn-primary btn-block" style="margin-top: 15px;">Register Driver</button>
    </form>
  `;

  const browseBtn = document.getElementById('browse-photo-btn');
  const fileInput = document.getElementById('drv-photo-file');
  const previewImg = document.getElementById('drv-photo-preview');

  browseBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        photoBase64 = event.target.result;
        previewImg.src = photoBase64;
        previewImg.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('create-driver-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchAPI('/api/drivers', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('drv-name').value,
          licenseNumber: document.getElementById('drv-lic').value,
          licenseCategory: document.getElementById('drv-category').value,
          licenseExpiry: document.getElementById('drv-expiry').value,
          phone: document.getElementById('drv-phone').value,
          tripCompletionRate: parseInt(document.getElementById('drv-trip-rate').value, 10),
          photo: photoBase64 || undefined,
        }),
      });
      showToast('Driver registered successfully!');
      modalContainer.classList.add('hidden');
      loadDrivers();
    } catch (err) {}
  });
}

async function renderTripForm() {
  modalBody.innerHTML = 'Loading fleet options...';

  try {
    const vehiclesData = await fetchAPI('/api/vehicles');
    const driversData = await fetchAPI('/api/drivers');

    const availableVehicles = vehiclesData.data.vehicles.filter(v => v.status === 'Available');
    const availableDrivers = driversData.data.drivers.filter(d => d.status === 'Available');

    let vehOptions = availableVehicles.map(v => `<option value="${v._id}">${v.registrationNumber} (Max ${v.capacityKg} kg)</option>`).join('');
    let drvOptions = availableDrivers.map(d => `<option value="${d._id}">${d.name}</option>`).join('');

    modalBody.innerHTML = `
      <form id="create-trip-form">
        <div class="input-group">
          <select id="trip-veh" required>${vehOptions ? vehOptions : '<option value="">No available vehicles</option>'}</select>
          <label for="trip-veh"><i class="fa-solid fa-truck"></i> Select Available Vehicle</label>
        </div>
        <div class="input-group">
          <select id="trip-drv" required>${drvOptions ? drvOptions : '<option value="">No available drivers</option>'}</select>
          <label for="trip-drv"><i class="fa-solid fa-user-tie"></i> Select Available Driver</label>
        </div>
        <div class="input-group">
          <input type="text" id="trip-source" required placeholder=" ">
          <label for="trip-source"><i class="fa-solid fa-location-dot"></i> Source Location</label>
        </div>
        <div class="input-group">
          <input type="text" id="trip-dest" required placeholder=" ">
          <label for="trip-dest"><i class="fa-solid fa-location-crosshairs"></i> Destination</label>
        </div>
        <div class="input-group">
          <input type="text" id="trip-desc" required placeholder=" ">
          <label for="trip-desc"><i class="fa-solid fa-box"></i> Cargo Description</label>
        </div>
        <div class="input-group">
          <input type="number" id="trip-weight" required placeholder=" ">
          <label for="trip-weight"><i class="fa-solid fa-weight-hanging"></i> Cargo Weight (Kg)</label>
        </div>
        <div class="input-group">
          <input type="number" id="trip-dist" required placeholder=" ">
          <label for="trip-dist"><i class="fa-solid fa-road"></i> Distance (Km)</label>
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
        showToast('Trip scheduled as Draft.');
        modalContainer.classList.add('hidden');
        loadTrips();
      } catch (err) {}
    });
  } catch (err) {
    modalBody.innerHTML = 'Failed to load options.';
  }
}

async function renderMaintenanceForm() {
  modalBody.innerHTML = 'Loading vehicles...';

  try {
    const vehiclesData = await fetchAPI('/api/vehicles');
    const availableVehicles = vehiclesData.data.vehicles.filter(v => v.status === 'Available');
    let options = availableVehicles.map(v => `<option value="${v._id}">${v.registrationNumber}</option>`).join('');

    modalBody.innerHTML = `
      <form id="create-maint-form">
        <div class="input-group">
          <select id="maint-veh" required>${options ? options : '<option value="">No available vehicles</option>'}</select>
          <label for="maint-veh"><i class="fa-solid fa-truck"></i> Select Available Vehicle</label>
        </div>
        <div class="input-group">
          <input type="text" id="maint-desc" required placeholder=" ">
          <label for="maint-desc"><i class="fa-solid fa-wrench"></i> Repair Description</label>
        </div>
        <div class="input-group">
          <input type="number" id="maint-cost" required placeholder=" ">
          <label for="maint-cost"><i class="fa-solid fa-dollar-sign"></i> Cost ($)</label>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Send to Workshop</button>
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
        showToast('Vehicle sent to workshop.');
        modalContainer.classList.add('hidden');
        loadMaintenance();
      } catch (err) {}
    });
  } catch (err) {
    modalBody.innerHTML = 'Failed to load options.';
  }
}

function renderFinanceForm() {
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
          <input type="text" id="exp-type" required placeholder=" ">
          <label for="exp-type"><i class="fa-solid fa-receipt"></i> Expense Type (Tolls, Parts, Fees)</label>
        </div>
        <div class="input-group">
          <input type="number" id="exp-amt" required placeholder=" ">
          <label for="exp-amt"><i class="fa-solid fa-dollar-sign"></i> Amount ($)</label>
        </div>
        <div class="input-group">
          <input type="date" id="exp-date" required placeholder=" ">
          <label for="exp-date"><i class="fa-solid fa-calendar-days"></i> Invoice Date</label>
        </div>
        <div class="input-group">
          <textarea id="exp-desc" placeholder=" "></textarea>
          <label for="exp-desc"><i class="fa-solid fa-paragraph"></i> Details</label>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Submit Pending Invoice</button>
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
        showToast('Expense logged. Placed in Pending approval list.');
        modalContainer.classList.add('hidden');
        loadExpenses();
      } catch (err) {}
    });
  };

  const showFuelForm = async () => {
    formContainer.innerHTML = 'Loading vehicle registry...';
    try {
      const vehiclesData = await fetchAPI('/api/vehicles');
      let options = vehiclesData.data.vehicles.map(v => `<option value="${v._id}">${v.registrationNumber}</option>`).join('');

      formContainer.innerHTML = `
        <form id="create-fuel-form">
          <div class="input-group">
            <select id="fuel-veh" required>${options}</select>
            <label for="fuel-veh"><i class="fa-solid fa-truck"></i> Select Vehicle</label>
          </div>
          <div class="input-group">
            <input type="number" id="fuel-lit" required placeholder=" ">
            <label for="fuel-lit"><i class="fa-solid fa-droplet"></i> Fuel Volume (Liters)</label>
          </div>
          <div class="input-group">
            <input type="number" id="fuel-cost" required placeholder=" ">
            <label for="fuel-cost"><i class="fa-solid fa-dollar-sign"></i> Cost ($)</label>
          </div>
          <div class="input-group">
            <input type="number" id="fuel-odo" required placeholder=" ">
            <label for="fuel-odo"><i class="fa-solid fa-gauge"></i> Odometer Reading (Km)</label>
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
          showToast('Fuel log recorded.');
          modalContainer.classList.add('hidden');
          loadFuelLogs();
        } catch (err) {}
      });
    } catch (err) {
      formContainer.innerHTML = 'Failed to load options.';
    }
  };

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

  showExpenseForm();
}

// ==========================================
// MOCKUP DRIVERS INTERACTION HANDLERS
// ==========================================
document.getElementById('drivers-search')?.addEventListener('input', () => {
  loadDrivers();
});

document.getElementById('btn-add-driver-mockup')?.addEventListener('click', () => {
  modalContainer.classList.remove('hidden');
  modalTitle.textContent = 'Register New Driver';
  renderDriverForm();
});

document.querySelectorAll('.toggle-stat-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!selectedDriverId) {
      showToast('Please select a driver from the table first.', 'error');
      return;
    }
    const newStatus = btn.dataset.status;
    try {
      await fetchAPI(`/api/drivers/${selectedDriverId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      showToast(`Driver status updated to ${newStatus}.`);
      loadDrivers();
    } catch (err) {
      console.error(err);
    }
  });
});
