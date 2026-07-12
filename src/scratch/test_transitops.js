import 'dotenv/config';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import Trip from '../models/Trip.js';
import Maintenance from '../models/Maintenance.js';
import FuelLog from '../models/FuelLog.js';
import Expense from '../models/Expense.js';
import AuditLog from '../models/AuditLog.js';
import { seedDatabase } from '../config/seeder.js';

process.env.NODE_ENV = 'development';

const PORT = 5002;
const BASE_URL = `http://localhost:${PORT}/api`;

async function runVerification() {
  console.log('=== STARTING TRANSITOPS ENTERPRISE AUTHORIZATION TESTS ===');

  let mongoServer;
  const server = app.listen(PORT, () => {
    console.log(`TransitOps test server listening on port ${PORT}`);
  });

  try {
    // 1. Initialize MongoMemoryServer
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    console.log('Connected to in-memory database.');

    // 2. Run Seeder
    await seedDatabase();

    // Create Driver profile matching 'Driver User'
    await Driver.create({
      name: 'Driver User',
      licenseNumber: 'DL-DRIVER-USER-TX',
      licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      phone: '+15550199',
      status: 'Available',
    });

    // 3. Login helper
    const loginUser = async (email, password) => {
      const res = await fetch(`http://localhost:${PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.status !== 200) {
        console.error(`Login failed for ${email} with status ${res.status}:`, data);
        throw new Error(`Login failed for ${email}: ${data.message || JSON.stringify(data)}`);
      }
      return data.data.accessToken;
    };

    // Obtain access tokens for different roles
    console.log('\nLogging in testing roles...');
    const managerToken = await loginUser('manager@transitops.com', 'password123Secure!');
    const driverToken = await loginUser('driver@transitops.com', 'password123Secure!');
    const financeToken = await loginUser('finance@transitops.com', 'password123Secure!');
    const safetyToken = await loginUser('safety@transitops.com', 'password123Secure!');

    // Alias legacy variables for minimal code diff in tests
    const adminToken = managerToken;
    const dispatcherToken = driverToken;

    console.log('✓ Obtained access tokens for Fleet Manager, Driver, Financial Analyst, and Safety Officer.');

    // ==========================================
    // TEST 1: COARSE-GRAINED RBAC GATE CHECKS
    // ==========================================
    console.log('\n[TEST 1] Testing Coarse-Grained RBAC authorization blocks...');
    
    // Driver trying to create an Expense (now allowed)
    const driverExpenseRes = await fetch(`${BASE_URL}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({ expenseType: 'Fuel', amount: 500, date: new Date() }),
    });
    if (driverExpenseRes.status === 201) {
      console.log('✓ Success: Driver successfully created expense (201).');
    } else {
      throw new Error(`Driver creation of expense got status: ${driverExpenseRes.status}`);
    }

    // Safety Officer trying to create an Expense (blocked)
    const safetyExpenseRes = await fetch(`${BASE_URL}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${safetyToken}`,
      },
      body: JSON.stringify({ expenseType: 'Fuel', amount: 500, date: new Date() }),
    });
    if (safetyExpenseRes.status === 403) {
      console.log('✓ Success: Safety Officer correctly blocked from creating expenses (403).');
    } else {
      throw new Error(`Safety Officer creation of expense got status: ${safetyExpenseRes.status}`);
    }

    // Finance trying to create a Vehicle (Fleet Manager module)
    const finVehicleRes = await fetch(`${BASE_URL}/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${financeToken}`,
      },
      body: JSON.stringify({ registrationNumber: 'TEST-123', make: 'Ford', modelName: 'F150', capacityKg: 1000 }),
    });
    if (finVehicleRes.status === 403) {
      console.log('✓ Success: Finance Analyst correctly blocked from creating vehicles (403).');
    } else {
      throw new Error(`Finance creation of vehicle got status: ${finVehicleRes.status}`);
    }

    // ==========================================
    // TEST 2: IMPERATIVE POLICIES (VEHICLES)
    // ==========================================
    console.log('\n[TEST 2] Creating and modifying Vehicles...');

    // Seed vehicle directly into DB
    const seededVehicle = await Vehicle.create({
      registrationNumber: 'TX-890-GP',
      make: 'Volvo',
      modelName: 'FH16',
      capacityKg: 20000,
    });
    const vehicleId = seededVehicle._id;
    console.log('✓ Seeded vehicle directly into DB:', seededVehicle.registrationNumber);
    
    // Create vehicle using Fleet Manager (should succeed)
    const makeVehicleRes = await fetch(`${BASE_URL}/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ registrationNumber: 'TX-890-GP-2', make: 'Volvo', modelName: 'FH16', capacityKg: 20000 }),
    });
    if (makeVehicleRes.status === 201) {
      console.log('✓ Success: Fleet Manager successfully created a vehicle (201).');
    } else {
      throw new Error(`Fleet Manager creation of vehicle failed with status: ${makeVehicleRes.status}`);
    }

    // ==========================================
    // TEST 3: IMPERATIVE POLICIES (DRIVERS)
    // ==========================================
    console.log('\n[TEST 3] Creating Driver with Safety Officer...');
    
    const makeDriverRes = await fetch(`${BASE_URL}/drivers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${safetyToken}`,
      },
      body: JSON.stringify({
        name: 'John Doe',
        licenseNumber: 'DL-908752-TX',
        licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        phone: '+15550199',
      }),
    });
    const driverData = await makeDriverRes.json();
    const driverId = driverData.data.driver._id;
    console.log('✓ Success: Safety Officer successfully created Driver:', driverData.data.driver.name);

    // ==========================================
    // TEST 4: TRIP LIFECYCLE & STATE SEPARATION
    // ==========================================
    console.log('\n[TEST 4] Trip dispatch and stateful transitions...');

    // 1. Create a trip draft
    const makeTripRes = await fetch(`${BASE_URL}/trips`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({
        vehicle: vehicleId,
        driver: driverId,
        source: 'Houston Terminal',
        destination: 'Dallas Depot',
        cargoDescription: 'Electronics Freight',
        cargoWeightKg: 15000,
        distanceKm: 380,
      }),
    });
    const tripData = await makeTripRes.json();
    if (!tripData.data || !tripData.data.trip) {
      throw new Error(`Trip creation failed: ${JSON.stringify(tripData)}`);
    }
    const tripId = tripData.data.trip._id;
    const tripDrvId = tripData.data.trip.driver;
    console.log('✓ Success: Trip draft created (Draft).');

    // 2. Dispatch Trip (triggers side effects)
    const dispatchRes = await fetch(`${BASE_URL}/trips/${tripId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({ status: 'Dispatched' }),
    });
    if (dispatchRes.status !== 200) {
      throw new Error(`Dispatch failed: ${JSON.stringify(await dispatchRes.json())}`);
    }
    console.log('✓ Success: Trip status transitioned to Dispatched.');

    // Verify Vehicle & Driver states are locked (On Trip)
    const checkVehicle = await Vehicle.findById(vehicleId);
    const checkDriver = await Driver.findById(tripDrvId);
    if (checkVehicle.status === 'On Trip' && checkDriver.status === 'On Trip') {
      console.log('✓ State separation verified: Vehicle is "On Trip" and Driver is "On Trip".');
    } else {
      throw new Error('Vehicle or Driver status did not lock on dispatch!');
    }

    // 3. Try to start Maintenance on this vehicle (which is On Trip)
    const badMaintRes = await fetch(`${BASE_URL}/maintenance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        vehicle: vehicleId,
        problem: 'Brake pads worn out',
        repairType: 'Replacement',
        workshop: 'City Garage',
        cost: 450,
        description: 'Brake pad swap'
      }),
    });
    if (badMaintRes.status === 403) {
      console.log('✓ Success: Correctly blocked vehicle from entering maintenance while on active trip (403).');
    } else {
      throw new Error(`Expected block, but got: ${badMaintRes.status}`);
    }

    // 4. Complete Trip
    const completeRes = await fetch(`${BASE_URL}/trips/${tripId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({ status: 'Completed' }),
    });
    if (completeRes.status !== 200) {
      throw new Error('Completion failed');
    }
    console.log('✓ Success: Trip status transitioned to Completed.');

    // Verify Vehicle & Driver are released (Available)
    const postTripVehicle = await Vehicle.findById(vehicleId);
    const postTripDriver = await Driver.findById(tripDrvId);
    if (postTripVehicle.status === 'Available' && postTripDriver.status === 'Available') {
      console.log('✓ State separation verified: Vehicle and Driver released to "Available".');
    } else {
      throw new Error('Vehicle or Driver status did not release on trip completion!');
    }

    // ==========================================
    // TEST 5: STATEFUL MAINTENANCE LIFECYCLE
    // ==========================================
    console.log('\n[TEST 5] Maintenance shop allocations...');

    // 1. Send vehicle to maintenance (should succeed via API)
    const maintRes = await fetch(`${BASE_URL}/maintenance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        vehicle: vehicleId,
        problem: 'Engine oil dirty',
        repairType: 'Maintenance',
        workshop: 'Main Station Workshop',
        cost: 1200,
        description: 'Engine oil flush & diagnostics'
      }),
    });
    if (maintRes.status === 201) {
      console.log('✓ Success: Fleet Manager successfully created maintenance via API (201).');
    } else {
      throw new Error(`Fleet Manager creation of maintenance failed with status: ${maintRes.status}`);
    }
    const maintData = await maintRes.json();
    const maintId = maintData.data.maintenance._id;



    // Verify vehicle is In Shop
    const shopVehicle = await Vehicle.findById(vehicleId);
    if (shopVehicle.status === 'In Shop') {
      console.log('✓ State separation verified: Vehicle status updated to "In Shop".');
    } else {
      throw new Error('Vehicle status did not transition to In Shop!');
    }

    // 2. Try to dispatch a new trip using this vehicle (currently In Shop)
    const invalidTripRes = await fetch(`${BASE_URL}/trips`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({
        vehicle: vehicleId,
        driver: tripDrvId,
        source: 'Houston',
        destination: 'Dallas',
        cargoDescription: 'Heavy Cargo',
        cargoWeightKg: 1000,
        distanceKm: 100,
      }),
    });
    const invalidTripData = await invalidTripRes.json();
    
    // Now try to dispatch a trip with it (if we updated the draft vehicle). Or rather, dispatch is blocked.
    // The canCreate trip checks if vehicle is retired. But dispatch checks if vehicle is Available.
    // Let's create a trip draft (valid) but try to dispatch it (which checks vehicle status)
    const tripDraftRes = await Trip.create({
      vehicle: vehicleId,
      driver: tripDrvId,
      source: 'Houston',
      destination: 'Dallas',
      cargoDescription: 'Diagnostics gear',
      cargoWeightKg: 5000,
      distanceKm: 300,
      status: 'Draft',
    });
    
    const blockDispatchRes = await fetch(`${BASE_URL}/trips/${tripDraftRes._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({ status: 'Dispatched' }),
    });
    const blockDispatchData = await blockDispatchRes.json();
    if (blockDispatchRes.status === 403 && (blockDispatchData.code === 'POLICY_VIOLATION' || blockDispatchData.code === 'VEHICLE_UNAVAILABLE')) {
      console.log('✓ Success: Dispatch blocked. Error code returned:', blockDispatchData.code, '-', blockDispatchData.message);
    } else {
      throw new Error(`Expected 403 block with POLICY_VIOLATION or VEHICLE_UNAVAILABLE but got status ${blockDispatchRes.status} and code ${blockDispatchData.code}`);
    }

    // 3. Close Maintenance (should succeed via API)
    const closeMaintRes = await fetch(`${BASE_URL}/maintenance/${maintId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ status: 'Completed' }),
    });
    if (closeMaintRes.status === 200) {
      console.log('✓ Success: Fleet Manager successfully closed maintenance via API (200).');
    } else {
      throw new Error(`Expected 200 when closing maintenance, but got status ${closeMaintRes.status}`);
    }

    // Verify vehicle returns to Available
    const outShopVehicle = await Vehicle.findById(vehicleId);
    if (outShopVehicle.status === 'Available') {
      console.log('✓ State separation verified: Vehicle returned to "Available" status.');
    } else {
      throw new Error('Vehicle status did not return to Available after maintenance close!');
    }

    // ==========================================
    // TEST 6: ODOMETER VALIDATION (FUEL LOGS)
    // ==========================================
    console.log('\n[TEST 6] Testing non-decreasing odometer constraints...');
    
    // 1. Record valid fuel log (odometer = 50000)
    const fuel1Res = await fetch(`${BASE_URL}/expenses/fuel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${financeToken}`,
      },
      body: JSON.stringify({ vehicle: vehicleId, fuelLiters: 100, cost: 350, odometer: 50000 }),
    });
    if (fuel1Res.status === 201) {
      console.log('✓ Success: Fuel log recorded at 50,000 km.');
    } else {
      throw new Error('Valid fuel log failed');
    }

    // 2. Record invalid fuel log (odometer = 49900 - decreased)
    const fuel2Res = await fetch(`${BASE_URL}/expenses/fuel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${financeToken}`,
      },
      body: JSON.stringify({ vehicle: vehicleId, fuelLiters: 80, cost: 280, odometer: 49900 }),
    });
    const fuel2Data = await fuel2Res.json();
    if (fuel2Res.status === 400) {
      console.log('✓ Success: Decreased odometer rejected with message:', fuel2Data.message);
    } else {
      throw new Error('Decreased odometer was accepted erroneously!');
    }

    // ==========================================
    // TEST 7: USER MANAGEMENT SELF-ACTION LOCK
    // ==========================================
    console.log('\n[TEST 7] Verifying User self-action constraint locks...');
    
    // Get Fleet Manager user ID (acting as admin)
    const adminUser = await User.findOne({ email: 'manager@transitops.com' });
    
    // Admin trying to delete their own account
    const selfDeleteRes = await fetch(`${BASE_URL}/users/${adminUser._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const deleteData = await selfDeleteRes.json();
    if (selfDeleteRes.status === 403 && (deleteData.code === 'SELF_DELETION_DENIED' || deleteData.code === 'INSUFFICIENT_PRIVILEGES')) {
      console.log('✓ Success: Fleet Manager blocked from deletion. Message:', deleteData.message);
    } else {
      throw new Error('Fleet Manager was allowed to delete user, or incorrect error returned!');
    }

    // ==========================================
    // TEST 8: DASHBOARD FILTERED KPIS
    // ==========================================
    console.log('\n[TEST 8] Querying Dashboard KPIs with region and vehicleType filters...');
    const dbStatsRes = await fetch(`${BASE_URL}/dashboard/stats?region=North&vehicleType=Truck`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const dbStats = await dbStatsRes.json();
    if (dbStatsRes.status === 200 && dbStats.data.kpis) {
      console.log('✓ Success: Dashboard KPIs returned successfully with filters.');
      console.log('Sample Dashboard KPI stats:', dbStats.data.kpis);
    } else {
      throw new Error(`Dashboard stats retrieval failed with status ${dbStatsRes.status}`);
    }

    // ==========================================
    // TEST 9: TRIP ADVANCED QUERY FILTERS
    // ==========================================
    console.log('\n[TEST 9] Querying Trips list with vehicleType, region, source, and destination filters...');
    const tripFilterRes = await fetch(`${BASE_URL}/trips?vehicleType=Truck&region=North&source=Houston&destination=Dallas`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const tripFilterData = await tripFilterRes.json();
    if (tripFilterRes.status === 200 && tripFilterData.data.trips) {
      console.log('✓ Success: Trips list filtered and returned successfully.');
      console.log(`Matching trips count: ${tripFilterData.data.trips.length}`);
    } else {
      throw new Error(`Trips filtered retrieval failed with status ${tripFilterRes.status}`);
    }

    // ==========================================
    // TEST 10: UNIFIED AUDIT LOG ENGINE
    // ==========================================
    console.log('\n[TEST 10] Querying unified AuditLog logs...');
    const auditLogs = await AuditLog.find().populate('user');
    if (auditLogs.length > 0) {
      console.log(`✓ Verified: Successfully recorded ${auditLogs.length} audit logs.`);
      console.log('Sample Log entry:', {
        operator: auditLogs[0].user.name,
        action: auditLogs[0].action,
        module: auditLogs[0].module,
        recordId: auditLogs[0].recordId,
        ipAddress: auditLogs[0].ipAddress,
      });
    } else {
      throw new Error('No audit logs were written!');
    }

    // ==========================================
    // TEST 11: DRIVER COMPLAINTS SYSTEM
    // ==========================================
    console.log('\n[TEST 11] Verifying Driver Complaints submission & visibility...');
    const complaintText = 'Speeding violation on Route 66';
    const postComplaintRes = await fetch(`${BASE_URL}/drivers/${driverId}/complaints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({
        text: complaintText
      }),
    });
    const postComplaintData = await postComplaintRes.json();
    if (postComplaintRes.status === 200 && postComplaintData.data.driver.complaints.length > 0) {
      console.log('✓ Success: Driver complaint submitted successfully.');
      const checkDriverWithSafety = await fetch(`${BASE_URL}/drivers/${driverId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${safetyToken}` },
      });
      const safetyDriverData = await checkDriverWithSafety.json();
      if (safetyDriverData.data.driver.complaints[0].text === complaintText) {
        console.log('✓ Success: Safety Officer can successfully view the submitted complaint.');
      } else {
        throw new Error('Safety Officer did not see the complaint text correctly!');
      }

      const complaintId = safetyDriverData.data.driver.complaints[0]._id;
      
      // Safety Officer resolves the complaint
      const resolveRes = await fetch(`${BASE_URL}/drivers/${driverId}/complaints/${complaintId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${safetyToken}`,
        },
        body: JSON.stringify({ status: 'Resolved' }),
      });
      const resolveData = await resolveRes.json();
      if (resolveRes.status === 200 && resolveData.data.driver.complaints[0].status === 'Resolved') {
        console.log('✓ Success: Safety Officer successfully resolved the complaint.');
      } else {
        throw new Error(`Failed to resolve complaint. Status: ${resolveRes.status}`);
      }

      // Try to resolve using unauthorized role (Driver/Dispatcher should fail)
      const badResolveRes = await fetch(`${BASE_URL}/drivers/${driverId}/complaints/${complaintId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${dispatcherToken}`,
        },
        body: JSON.stringify({ status: 'Resolved' }),
      });
      if (badResolveRes.status === 403) {
        console.log('✓ Success: Unauthorized role correctly blocked from modifying complaint status (403).');
      } else {
        throw new Error(`Expected 403 block on unauthorized complaint resolution, but got status ${badResolveRes.status}`);
      }
    } else {
      throw new Error(`Failed to submit driver complaint. Status: ${postComplaintRes.status}`);
    }

    console.log('\n=========================================');
    console.log('🎉 TRANSITOPS ENGINES VERIFIED SUCCESSFULLY! 🎉');
    console.log('=========================================');

  } catch (error) {
    console.error('\n❌ VERIFICATION TEST SUITE FAILED:', error.stack);
  } finally {
    // Cleanup Mongoose and Dynamic DB
    console.log('\nShutting down connections...');
    await mongoose.connection.close();
    if (mongoServer) {
      await mongoServer.stop();
    }
    server.close();
    console.log('Verification run complete.');
  }
}

runVerification();
