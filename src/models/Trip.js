import mongoose from 'mongoose';

const tripSchema = new mongoose.Schema(
  {
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: [true, 'Vehicle is required for a trip'],
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      required: [true, 'Driver is required for a trip'],
    },
    source: {
      type: String,
      required: [true, 'Source location is required'],
      trim: true,
    },
    destination: {
      type: String,
      required: [true, 'Destination location is required'],
      trim: true,
    },
    cargoDescription: {
      type: String,
      required: [true, 'Cargo description is required'],
      trim: true,
    },
    cargoWeightKg: {
      type: Number,
      required: [true, 'Cargo weight in kg is required'],
      min: [0, 'Cargo weight cannot be negative'],
    },
    distanceKm: {
      type: Number,
      required: [true, 'Distance in km is required'],
      min: [0, 'Distance cannot be negative'],
    },
    status: {
      type: String,
      enum: ['Draft', 'Dispatched', 'Completed', 'Cancelled'],
      default: 'Draft',
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

// Query middleware to exclude soft deleted trips
tripSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: { $ne: true } });
  next();
});

const Trip = mongoose.model('Trip', tripSchema);
export default Trip;
