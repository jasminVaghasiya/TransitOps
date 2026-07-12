import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema(
  {
    registrationNumber: {
      type: String,
      required: [true, 'Registration number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    make: {
      type: String,
      required: [true, 'Make is required'],
      trim: true,
    },
    modelName: {
      type: String,
      required: [true, 'Model name is required'],
      trim: true,
    },
    capacityKg: {
      type: Number,
      required: [true, 'Capacity in kg is required'],
      min: [0, 'Capacity cannot be negative'],
    },
    status: {
      type: String,
      enum: ['Available', 'On Trip', 'In Shop', 'Retired'],
      default: 'Available',
    },
    vehicleType: {
      type: String,
      enum: ['Truck', 'Van', 'Trailer', 'Car'],
      default: 'Truck',
    },
    region: {
      type: String,
      enum: ['North', 'South', 'East', 'West'],
      default: 'North',
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

// Query middleware to exclude soft deleted vehicles
vehicleSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: { $ne: true } });
  next();
});

const Vehicle = mongoose.model('Vehicle', vehicleSchema);
export default Vehicle;
