let accessToken = null;

async function fetchAPI(url, options = {}) {
  options.headers = options.headers || {};
  if (accessToken) {
    options.headers['Authorization'] = `Bearer ${accessToken}`;
  }
  options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';

  try {
    let res = await fetch(url, options);

    if (res.status === 401) {
      const refreshed = await performSilentRefresh();
      if (refreshed) {
        options.headers['Authorization'] = `Bearer ${accessToken}`;
        res = await fetch(url, options);
      } else {
        alert('Session expired. Please log in again.');
        window.location.href = 'index.html';
        return null;
      }
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'API request failed');
    }
    return data;
  } catch (error) {
    console.error('API Error:', error);
    alert(error.message);
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
    return false;
  }
}

async function loadHistory(id) {
  try {
    const response = await fetchAPI(`/api/vehicles/${id}/history`);
    if (!response || response.status !== 'success') return;

    const { vehicle, trips, fuelLogs, maintenance } = response.data;

    // Render header
    document.getElementById('vehicle-title').textContent = vehicle.registrationNumber;
    document.getElementById('vehicle-make-model').textContent = `${vehicle.make} ${vehicle.modelName}`;
    document.getElementById('vehicle-capacity').textContent = `${vehicle.capacityKg.toLocaleString()} Kg`;
    
    const statusBadge = document.getElementById('vehicle-status');
    statusBadge.textContent = vehicle.status;
    statusBadge.className = `badge status-${vehicle.status.replace(' ', '-')}`;

    // Render Photo
    const photoContainer = document.getElementById('vehicle-photo');
    const defaultPhoto = 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=400&q=80';
    photoContainer.innerHTML = `<img src="${vehicle.photoUrl || defaultPhoto}" alt="${vehicle.registrationNumber}">`;

    // Render Acquisition / Disposal Info
    document.getElementById('info-purchase-price').textContent = vehicle.purchasePrice ? `$${vehicle.purchasePrice.toLocaleString()}` : '—';
    document.getElementById('info-purchase-date').textContent = vehicle.purchaseDate ? new Date(vehicle.purchaseDate).toLocaleDateString() : '—';
    document.getElementById('info-status').textContent = vehicle.status;
    document.getElementById('info-selling-price').textContent = vehicle.sellingPrice ? `$${vehicle.sellingPrice.toLocaleString()}` : '—';
    document.getElementById('info-sale-date').textContent = vehicle.saleDate ? new Date(vehicle.saleDate).toLocaleDateString() : '—';

    // Render Maintenance History
    const maintContainer = document.getElementById('maintenance-logs');
    if (maintenance.length === 0) {
      maintContainer.innerHTML = '<div class="empty-message">No repair history found.</div>';
    } else {
      maintContainer.innerHTML = maintenance.map(log => `
        <div class="history-item">
          <div class="item-header">
            <strong>${log.description}</strong>
            <span class="badge status-${log.status}">${log.status}</span>
          </div>
          <div class="item-body">
            Cost: <strong>$${log.cost.toLocaleString()}</strong><br>
            Opened: ${new Date(log.startDate).toLocaleDateString()} 
            ${log.endDate ? `| Closed: ${new Date(log.endDate).toLocaleDateString()}` : ''}
          </div>
        </div>
      `).join('');
    }

    // Render Trips & Driver History
    const tripsContainer = document.getElementById('trips-logs');
    if (trips.length === 0) {
      tripsContainer.innerHTML = '<div class="empty-message">No dispatch records found.</div>';
    } else {
      tripsContainer.innerHTML = trips.map(trip => `
        <div class="history-item">
          <div class="item-header">
            <strong>${trip.source} ➔ ${trip.destination}</strong>
            <span class="badge status-${trip.status}">${trip.status}</span>
          </div>
          <div class="item-body">
            Driver: <strong>${trip.driver?.name || 'Unassigned'}</strong> (License: ${trip.driver?.licenseNumber || 'N/A'})<br>
            Cargo: ${trip.cargoDescription} (${trip.cargoWeightKg.toLocaleString()} Kg) | Distance: ${trip.distanceKm} Km
          </div>
        </div>
      `).join('');
    }

    // Render Fuel Logs
    const fuelContainer = document.getElementById('fuel-logs');
    if (fuelLogs.length === 0) {
      fuelContainer.innerHTML = '<div class="empty-message">No fuel records found.</div>';
    } else {
      fuelContainer.innerHTML = fuelLogs.map(log => `
        <div class="history-item">
          <div class="item-header">
            <strong>Volume: ${log.fuelLiters} L</strong>
            <span style="color: var(--success); font-weight: 600;">$${log.cost.toLocaleString()}</span>
          </div>
          <div class="item-body">
            Date: ${new Date(log.date).toLocaleDateString()} | Odometer: ${log.odometer.toLocaleString()} Km
          </div>
        </div>
      `).join('');
    }

    // Render Actions
    const actionsContainer = document.getElementById('header-actions');
    if (vehicle.status !== 'Retired' && vehicle.status !== 'Sold') {
      actionsContainer.innerHTML = `
        <button class="btn btn-logout" id="detail-retire-btn" style="padding: 8px 16px; font-size: 13px;">Retire Vehicle</button>
      `;
      
      document.getElementById('detail-retire-btn').addEventListener('click', () => {
        const modalContainer = document.getElementById('modal-container');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        
        modalContainer.classList.remove('hidden');
        modalTitle.textContent = 'Retire Vehicle';
        modalBody.innerHTML = `
          <div style="text-align: center; padding: 20px 0;">
            <i class="fa-solid fa-circle-exclamation" style="font-size: 48px; color: var(--danger); margin-bottom: 16px;"></i>
            <p style="font-size: 16px; margin-bottom: 24px; color: var(--text-main);">Are you sure you want to retire this vehicle? This action is final.</p>
            <div style="display: flex; justify-content: center; gap: 12px;">
              <button class="btn btn-outline" id="confirm-retire-cancel">Cancel</button>
              <button class="btn btn-logout" id="confirm-retire-btn" style="background-color: var(--danger); color: #fff;">Retire Vehicle</button>
            </div>
          </div>
        `;
        
        document.getElementById('confirm-retire-cancel').addEventListener('click', () => {
          modalContainer.classList.add('hidden');
        });
        
        document.getElementById('confirm-retire-btn').addEventListener('click', async () => {
          try {
            await fetchAPI(`/api/vehicles/${vehicle._id}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'Retired' })
            });
            modalContainer.classList.add('hidden');
            alert('Vehicle retired successfully.');
            window.location.reload();
          } catch (err) {
            console.error(err);
          }
        });
      });
    } else if (vehicle.status === 'Retired') {
      actionsContainer.innerHTML = `
        <button class="btn btn-primary" id="detail-reactivate-btn" style="padding: 8px 16px; font-size: 13px; background:#3B82F6; border-color:#3B82F6;">Reactivate Vehicle</button>
      `;
      
      document.getElementById('detail-reactivate-btn').addEventListener('click', () => {
        const modalContainer = document.getElementById('modal-container');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        
        modalContainer.classList.remove('hidden');
        modalTitle.textContent = 'Reactivate Vehicle';
        modalBody.innerHTML = `
          <div style="text-align: center; padding: 20px 0;">
            <i class="fa-solid fa-circle-question" style="font-size: 48px; color: var(--info); margin-bottom: 16px;"></i>
            <p style="font-size: 16px; margin-bottom: 24px; color: var(--text-main);">Are you sure you want to reactivate this vehicle?</p>
            <div style="display: flex; justify-content: center; gap: 12px;">
              <button class="btn btn-outline" id="confirm-reactivate-cancel">Cancel</button>
              <button class="btn btn-primary" id="confirm-reactivate-btn" style="background-color: var(--info); color: #fff;">Reactivate Vehicle</button>
            </div>
          </div>
        `;
        
        document.getElementById('confirm-reactivate-cancel').addEventListener('click', () => {
          modalContainer.classList.add('hidden');
        });
        
        document.getElementById('confirm-reactivate-btn').addEventListener('click', async () => {
          try {
            await fetchAPI(`/api/vehicles/${vehicle._id}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'Available' })
            });
            modalContainer.classList.add('hidden');
            alert('Vehicle reactivated successfully.');
            window.location.reload();
          } catch (err) {
            console.error(err);
          }
        });
      });
    } else {
      actionsContainer.innerHTML = '';
    }

  } catch (err) {
    console.error(err);
  }
}

async function init() {
  const refreshed = await performSilentRefresh();
  if (!refreshed) {
    alert('Session expired. Please log in first.');
    window.location.href = 'index.html';
    return;
  }

  const modalClose = document.getElementById('modal-close');
  if (modalClose) {
    modalClose.addEventListener('click', () => {
      document.getElementById('modal-container').classList.add('hidden');
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');
  if (id) {
    await loadHistory(id);
  } else {
    alert('No vehicle identifier supplied.');
  }
}

document.addEventListener('DOMContentLoaded', init);
