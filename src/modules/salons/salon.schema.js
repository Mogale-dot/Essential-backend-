const z = require('zod');

exports.createSalonSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  location: z.string().optional(),
  logo_url: z.string().url().optional(),
  banner_url: z.string().url().optional()
});
