
  require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

// Importing  all route modules
const oauthRoutes = require('./modules/auth/oauth.routes');
const authRouter = require('./modules/auth/auth.routes');
const salonRouter = require('./modules/salons/salon.routes');
const membersRouter = require('./modules/members/members.routes');
const servicesRouter = require('./modules/services-rewards/services.routes');
const rewardsRouter = require('./modules/services-rewards/rewards.routes');
const customersScanRouter = require('./modules/customers-scan/customers.routes');
const customerVisitRouter = require('./modules/customer-visit/visit.routes');
const adminRedemptionRouter = require('./modules/admin/redemption/redemption.routes');
const customerStatusRouter = require('./modules/rewards/status.routes'); // ✅ Import customer status routes
const salonPostRouter = require('./modules/posts/salonPost.routes'); 
const feedRoutes = require("./modules/feed/feed.routes");
const salonFeedRoutes = require("./modules/salon-feed/salonFeed.routes");
const reviewRoutes = require("./modules/reviews/customerReview.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const errorHandler = require('./middlewares/error.middleware');
const searchRoutes = require("./modules/search/search.routes");
const profileRoutes = require("./modules/profile/profile.routes");


const app = express();

// Middleware
const corsOptions = {
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'X-Requested-With'],
  optionsSuccessStatus: 204
};

// Applying  CORS middleware - this handles OPTIONS preflight automatically
app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));
 



// ========== MOUNT ROUTES ========== 



app.use('/auth', oauthRoutes);
app.use('/auth', authRouter);                  // /auth/login, /auth/signup, /auth/register-salon
app.use('/salons', salonRouter);               // /salons/my-salon, /salons/:id
app.use('/members', membersRouter);            // /members, /members/:id/role, etc.
app.use('/services', servicesRouter);          // /services, /services/bulk
app.use('/rewards', rewardsRouter);            // /rewards, /rewards/bulk
app.use('/admin/redemption', adminRedemptionRouter); 
app.use('/api/salon', salonPostRouter);
app.use("/api/salon/dashboard", dashboardRoutes);

// Customer side routes
app.use('/customers', customersScanRouter);    // /customers/identify, /customers
app.use('/visits', customerVisitRouter);       // /visits
app.use('/customer', customerStatusRouter);    // ✅ /customer/salons, /customer/rewards/status, /customer/request-redemption
app.use("/api/feed", feedRoutes);
app.use("/api/salons",  salonFeedRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/profile", profileRoutes);




// Mount admin routes

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;