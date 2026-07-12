import mongoose from 'mongoose';

const fuelLogSchema = new mongoose.Schema(
  {
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: [true, 'Vehicle is required for fuel log'],
    },
    date: {
      type: Date,
      required: [true, 'Fuel log date is required'],
      default: Date.now,
    },
    fuelLiters: {
      type: Number,
      required: [true, 'Fuel amount in liters is required'],
      min: [0.01, 'Fuel amount must be greater than zero'],
    },
    cost: {
      type: Number,
      required: [true, 'Fuel cost is required'],
      min: [0.01, 'Fuel cost must be greater than zero'],
    },
    odometer: {
      type: Number,
      required: [true, 'Odometer reading is required'],
      min: [0, 'Odometer reading cannot be negative'],
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Query middleware to exclude soft deleted fuel logs
fuelLogSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: { $ne: true } });
  next();
});

const FuelLog = mongoose.model('FuelLog', fuelLogSchema);
export default FuelLog;
