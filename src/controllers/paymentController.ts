import { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/paymentService';
import { UsageTrackingService } from '../services/usageTrackingService';
import { Logger } from '../utils/logger';
import { 
  APIResponse, 
  ValidationError, 
  FlowmatikError,
  AuthorizationError 
} from '../types';

export class PaymentController {
  private paymentService: PaymentService;
  private usageService: UsageTrackingService;
  private logger: Logger;

  constructor(
    paymentService: PaymentService,
    usageService: UsageTrackingService
  ) {
    this.paymentService = paymentService;
    this.usageService = usageService;
    this.logger = new Logger('PaymentController');
  }

  /**
   * Get subscription plans
   * GET /api/payments/plans
   */
  getPlans = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plans = [
        {
          id: 'free',
          name: 'Free',
          price: 0,
          currency: 'USD',
          interval: 'month',
          features: [
            '100 AI requests per day',
            '50K tokens per day',
            'Basic chat support',
            'Community access'
          ],
          limits: {
            requests: 100,
            tokens: 50000,
            multimedia: false
          }
        },
        {
          id: 'starter',
          name: 'Starter',
          price: 19,
          currency: 'USD',
          interval: 'month',
          stripePriceId: 'price_starter_monthly',
          lemonSqueezyVariantId: 'variant_starter',
          features: [
            '1,000 AI requests per day',
            '500K tokens per day',
            'Image generation',
            'Priority support',
            'API access'
          ],
          limits: {
            requests: 1000,
            tokens: 500000,
            multimedia: true
          }
        },
        {
          id: 'pro',
          name: 'Pro',
          price: 39,
          currency: 'USD',
          interval: 'month',
          stripePriceId: 'price_pro_monthly',
          lemonSqueezyVariantId: 'variant_pro',
          features: [
            '10,000 AI requests per day',
            '5M tokens per day',
            'All multimedia generation',
            'Advanced analytics',
            'Priority support',
            'Custom workflows'
          ],
          limits: {
            requests: 10000,
            tokens: 5000000,
            multimedia: true
          }
        },
        {
          id: 'business',
          name: 'Business',
          price: 79,
          currency: 'USD',
          interval: 'month',
          stripePriceId: 'price_business_monthly',
          lemonSqueezyVariantId: 'variant_business',
          features: [
            'Unlimited AI requests',
            'Unlimited tokens',
            'All features included',
            'Dedicated support',
            'Custom integrations',
            'SLA guarantee'
          ],
          limits: {
            requests: -1,
            tokens: -1,
            multimedia: true
          }
        }
      ];

      const response: APIResponse = {
        success: true,
        data: { plans },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get current subscription
   * GET /api/payments/subscription
   */
  getSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      const subscription = await this.paymentService.getUserSubscription(user.id);
      const usage = await this.usageService.getCurrentUsage(user.id);

      const response: APIResponse = {
        success: true,
        data: {
          subscription,
          usage
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create Stripe subscription
   * POST /api/payments/subscribe/stripe
   */
  createStripeSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { priceId, paymentMethodId } = req.body;

      if (!priceId) {
        throw new ValidationError('Price ID is required');
      }

      // Check if user already has an active subscription
      const existingSubscription = await this.paymentService.getUserSubscription(user.id);
      if (existingSubscription && existingSubscription.status === 'active') {
        throw new ValidationError('User already has an active subscription');
      }

      const result = await this.paymentService.createStripeSubscription(
        user.id,
        priceId,
        paymentMethodId
      );

      const response: APIResponse = {
        success: true,
        data: {
          subscription: result.subscription,
          clientSecret: result.clientSecret,
          requiresAction: !!result.clientSecret
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Stripe subscription created for user ${user.id}: ${result.subscription.id}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create LemonSqueezy subscription
   * POST /api/payments/subscribe/lemonsqueezy
   */
  createLemonSqueezySubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { variantId } = req.body;

      if (!variantId) {
        throw new ValidationError('Variant ID is required');
      }

      // Check if user already has an active subscription
      const existingSubscription = await this.paymentService.getUserSubscription(user.id);
      if (existingSubscription && existingSubscription.status === 'active') {
        throw new ValidationError('User already has an active subscription');
      }

      const result = await this.paymentService.createLemonSqueezySubscription(
        user.id,
        variantId
      );

      const response: APIResponse = {
        success: true,
        data: {
          subscription: result.subscription,
          checkoutUrl: result.checkoutUrl
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`LemonSqueezy subscription created for user ${user.id}: ${result.subscription.id}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Cancel subscription
   * POST /api/payments/subscription/cancel
   */
  cancelSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { immediately = false } = req.body;

      const subscription = await this.paymentService.getUserSubscription(user.id);
      if (!subscription) {
        throw new ValidationError('No active subscription found');
      }

      await this.paymentService.cancelSubscription(subscription.id, immediately);

      const response: APIResponse = {
        success: true,
        data: {
          message: immediately 
            ? 'Subscription cancelled immediately' 
            : 'Subscription will be cancelled at the end of the current period',
          cancelledImmediately: immediately
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Subscription cancelled for user ${user.id}: ${subscription.id}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update subscription plan
   * PUT /api/payments/subscription/plan
   */
  updateSubscriptionPlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { newPriceId } = req.body;

      if (!newPriceId) {
        throw new ValidationError('New price ID is required');
      }

      const subscription = await this.paymentService.getUserSubscription(user.id);
      if (!subscription) {
        throw new ValidationError('No active subscription found');
      }

      const updatedSubscription = await this.paymentService.updateSubscriptionPlan(
        subscription.id,
        newPriceId
      );

      const response: APIResponse = {
        success: true,
        data: {
          subscription: updatedSubscription,
          message: 'Subscription plan updated successfully'
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Subscription plan updated for user ${user.id}: ${newPriceId}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Add payment method
   * POST /api/payments/payment-methods
   */
  addPaymentMethod = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { paymentMethodId, setAsDefault = false } = req.body;

      if (!paymentMethodId) {
        throw new ValidationError('Payment method ID is required');
      }

      const paymentMethod = await this.paymentService.addPaymentMethod(
        user.id,
        paymentMethodId,
        setAsDefault
      );

      const response: APIResponse = {
        success: true,
        data: {
          paymentMethod,
          message: 'Payment method added successfully'
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Payment method added for user ${user.id}: ${paymentMethodId}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get payment methods
   * GET /api/payments/payment-methods
   */
  getPaymentMethods = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      const paymentMethods = await this.paymentService.getPaymentMethods(user.id);

      const response: APIResponse = {
        success: true,
        data: { paymentMethods },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Remove payment method
   * DELETE /api/payments/payment-methods/:paymentMethodId
   */
  removePaymentMethod = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { paymentMethodId } = req.params;

      await this.paymentService.removePaymentMethod(paymentMethodId);

      const response: APIResponse = {
        success: true,
        data: { message: 'Payment method removed successfully' },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      this.logger.info(`Payment method removed for user ${user.id}: ${paymentMethodId}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get invoices
   * GET /api/payments/invoices
   */
  getInvoices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { limit = 10 } = req.query;

      const invoices = await this.paymentService.getUserInvoices(
        user.id,
        parseInt(limit as string)
      );

      const response: APIResponse = {
        success: true,
        data: { invoices },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get billing summary
   * GET /api/payments/billing-summary
   */
  getBillingSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        throw new ValidationError('Start date and end date are required');
      }

      const summary = await this.usageService.getBillingSummary(
        user.id,
        new Date(startDate as string),
        new Date(endDate as string)
      );

      const response: APIResponse = {
        success: true,
        data: { summary },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create Stripe setup intent for saving payment method
   * POST /api/payments/setup-intent
   */
  createSetupIntent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;

      // This would create a Stripe setup intent
      // For now, return a placeholder
      const response: APIResponse = {
        success: true,
        data: {
          clientSecret: 'seti_placeholder_client_secret',
          message: 'Setup intent created successfully'
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Preview subscription change
   * POST /api/payments/subscription/preview
   */
  previewSubscriptionChange = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { newPriceId } = req.body;

      if (!newPriceId) {
        throw new ValidationError('New price ID is required');
      }

      // This would calculate proration and preview the change
      // For now, return a placeholder
      const response: APIResponse = {
        success: true,
        data: {
          preview: {
            immediateCharge: 0,
            nextInvoiceAmount: 39.00,
            prorationCredit: 0,
            effectiveDate: new Date()
          }
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get payment history
   * GET /api/payments/history
   */
  getPaymentHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { limit = 20, offset = 0 } = req.query;

      // This would get payment history from Stripe/LemonSqueezy
      // For now, return a placeholder
      const response: APIResponse = {
        success: true,
        data: {
          payments: [],
          pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            total: 0,
            hasMore: false
          }
        },
        metadata: {
          timestamp: new Date(),
          requestId: req.headers['x-request-id'] as string,
          version: '1.0'
        }
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Download invoice
   * GET /api/payments/invoices/:invoiceId/download
   */
  downloadInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const { invoiceId } = req.params;

      // This would generate and return the invoice PDF
      // For now, return a placeholder
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
      res.send(Buffer.from('PDF placeholder'));

      this.logger.info(`Invoice downloaded by user ${user.id}: ${invoiceId}`);
    } catch (error) {
      next(error);
    }
  };
}

