/**
 * Express middleware to validate request body against a Joi schema.
 * @param {Object} schema - Joi schema object
 */
export const validateBody = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Include all validation errors, not just the first one
      allowUnknown: false, // Reject unknown fields to prevent parameter injection
      stripUnknown: true, // Strip any extra properties not defined in the schema
    });

    if (error) {
      const errorMessages = error.details.map((detail) => detail.message);
      return res.status(400).json({
        status: 'fail',
        message: 'Validation failed',
        errors: errorMessages,
      });
    }

    // Replace request body with the cleaned/validated values
    req.body = value;
    next();
  };
};
