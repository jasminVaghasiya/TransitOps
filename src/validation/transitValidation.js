import Joi from 'joi';

// Helper to validate MongoDB ObjectIds
const objectId = (value, helpers) => {
  if (!value.match(/^[0-9a-fA-F]{24}$/)) {
    return helpers.message('"{{#label}}" must be a valid database identifier');
  }
  return value;
};

export const vehicleSchema = Joi.object({
  registrationNumber: Joi.string().trim().uppercase().required(),
  make: Joi.string().trim().required(),
  modelName: Joi.string().trim().required(),
  capacityKg: Joi.number().positive().required(),
  status: Joi.string().valid('Available', 'On Trip', 'In Shop', 'Retired', 'Sold').default('Available'),
  purchasePrice: Joi.number().positive().optional(),
  purchaseDate: Joi.date().optional(),
  photoUrl: Joi.string().trim().allow('').optional(),
});

export const driverSchema = Joi.object({
  name: Joi.string().trim().required(),
  licenseNumber: Joi.string().trim().uppercase().required(),
  licenseExpiry: Joi.date().required(),
  phone: Joi.string().trim().pattern(/^\+?[1-9]\d{1,14}$/).required()
    .messages({ 'string.pattern.base': 'Phone must be a valid E.164 international format (+1234567890)' }),
  status: Joi.string().valid('Available', 'On Trip', 'Suspended', 'Off Duty').default('Available'),
  safetyScore: Joi.number().min(0).max(100).default(100),
});

export const tripSchema = Joi.object({
  vehicle: Joi.string().custom(objectId).required(),
  driver: Joi.string().custom(objectId).required(),
  source: Joi.string().trim().required(),
  destination: Joi.string().trim().required(),
  cargoDescription: Joi.string().trim().required(),
  cargoWeightKg: Joi.number().min(0.01).required(),
  distanceKm: Joi.number().min(0.01).required(),
  status: Joi.string().valid('Draft', 'Dispatched', 'Completed', 'Cancelled').default('Draft'),
});

export const maintenanceSchema = Joi.object({
  vehicle: Joi.string().custom(objectId).required(),
  maintenanceDate: Joi.date().default(() => new Date()),
  problem: Joi.string().trim().required(),
  repairType: Joi.string().trim().required(),
  workshop: Joi.string().trim().required(),
  cost: Joi.number().min(0).required(),
  status: Joi.string().valid('In Progress', 'Completed').default('In Progress'),
  description: Joi.string().trim().optional().allow(''),
});

export const fuelLogSchema = Joi.object({
  vehicle: Joi.string().custom(objectId).required(),
  date: Joi.date().max('now').default(() => new Date()),
  fuelLiters: Joi.number().positive().required(),
  cost: Joi.number().positive().required(),
  odometer: Joi.number().min(0).required(),
});

export const expenseSchema = Joi.object({
  expenseType: Joi.string().trim().required(),
  amount: Joi.number().positive().required(),
  date: Joi.date().max('now').required(),
  description: Joi.string().trim().allow(''),
  vehicle: Joi.string().custom(objectId).optional(),
  trip: Joi.string().custom(objectId).optional(),
  status: Joi.string().valid('Pending', 'Approved', 'Rejected').default('Pending'),
});

export const userAdminUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50),
  email: Joi.string().trim().email(),
  password: Joi.string().min(8),
  role: Joi.string().valid('fleet_manager', 'dispatcher', 'safety_officer', 'financial_analyst', 'admin', 'read_only'),
  isActive: Joi.boolean(),
});

// Update schemas (fields are optional for PATCH requests)
export const updateVehicleSchema = Joi.object({
  registrationNumber: Joi.string().trim().uppercase().optional(),
  make: Joi.string().trim().optional(),
  modelName: Joi.string().trim().optional(),
  capacityKg: Joi.number().positive().optional(),
  status: Joi.string().valid('Available', 'On Trip', 'In Shop', 'Retired', 'Sold').optional(),
  purchasePrice: Joi.number().positive().optional(),
  purchaseDate: Joi.date().optional(),
  sellingPrice: Joi.number().positive().optional(),
  saleDate: Joi.date().optional(),
  photoUrl: Joi.string().trim().allow('').optional(),
});

export const updateDriverSchema = Joi.object({
  name: Joi.string().trim().optional(),
  licenseNumber: Joi.string().trim().uppercase().optional(),
  licenseExpiry: Joi.date().optional(),
  phone: Joi.string().trim().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
  status: Joi.string().valid('Available', 'On Trip', 'Suspended', 'Off Duty').optional(),
  safetyScore: Joi.number().min(0).max(100).optional(),
});

export const updateTripSchema = Joi.object({
  vehicle: Joi.string().custom(objectId).optional(),
  driver: Joi.string().custom(objectId).optional(),
  source: Joi.string().trim().optional(),
  destination: Joi.string().trim().optional(),
  cargoDescription: Joi.string().trim().optional(),
  cargoWeightKg: Joi.number().min(0.01).optional(),
  distanceKm: Joi.number().min(0.01).optional(),
  status: Joi.string().valid('Draft', 'Dispatched', 'Completed', 'Cancelled').optional(),
});

export const updateMaintenanceSchema = Joi.object({
  vehicle: Joi.string().custom(objectId).optional(),
  maintenanceDate: Joi.date().optional(),
  problem: Joi.string().trim().optional(),
  repairType: Joi.string().trim().optional(),
  workshop: Joi.string().trim().optional(),
  cost: Joi.number().min(0).optional(),
  status: Joi.string().valid('In Progress', 'Completed').optional(),
  description: Joi.string().trim().optional().allow(''),
});

export const updateExpenseSchema = Joi.object({
  expenseType: Joi.string().trim().optional(),
  amount: Joi.number().positive().optional(),
  date: Joi.date().max('now').optional(),
  description: Joi.string().trim().allow('').optional(),
  vehicle: Joi.string().custom(objectId).optional(),
  trip: Joi.string().custom(objectId).optional(),
  status: Joi.string().valid('Pending', 'Approved', 'Rejected').optional(),
});

