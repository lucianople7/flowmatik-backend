import Stripe from 'stripe';
import axios from 'axios';
import { DatabaseService } from './databaseService';
import { Logger } from '../utils/logger';
import { 
  Subscription, 
  PaymentMethod, 
  Invoice, 
  User,
  FlowmatikError 
} from '../types';

export class PaymentService {
  private stripe: Stripe;
  private lemonSqueezy: any;
  private db: DatabaseService;
  private logger: Logger;

  constructor(
    db: DatabaseService,
    config: {
      stripe: {
        secretKey: string;
        webhookSecret: string;
      };
      lemonSqueezy: {
        apiKey: string;
        webhookSecret: string;
      };
    }
  ) {
    this.db = db;
    this.logger = new Logger('PaymentService');

    // Initialize Stripe
    this.stripe = new Stripe(config.stripe.secretKey, {
      apiVersion: '2023-10-16'
    });

    // Initialize LemonSqueezy client
    this.lemonSqueezy = {
      apiKey: config.lemonSqueezy.apiKey,
      baseURL: 'https://api.lemonsqueezy.com/v1',
      client: axios.create({
        baseURL: 'https://api.lemonsqueezy.com/v1',
        headers: {
          'Authorization': `Bearer ${config.lemonSqueezy.apiKey}`,
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json'
        }
      })
    };
  }

  /**
   * Create Stripe customer
   */
  async createStripeCustomer(user: User): Promise<string> {
    try {
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user.id,
          source: 'flowmatik'
        }
      });

      // Store customer ID in database
      await this.db.query(
        'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
        [customer.id, user.id]
      );

      this.logger.info(`Stripe customer created: ${customer.id} for user ${user.id}`);
      return customer.id;
    } catch (error) {
      this.logger.error('Failed to create Stripe customer:', error);
      throw new FlowmatikError('Failed to create payment account', 'PAYMENT_SETUP_ERROR');
    }
  }

  /**
   * Create LemonSqueezy customer
   */
  async createLemonSqueezyCustomer(user: User): Promise<string> {
    try {
      const response = await this.lemonSqueezy.client.post('/customers', {
        data: {
          type: 'customers',
          attributes: {
            name: user.name,
            email: user.email
          }
        }
      });

      const customerId = response.data.data.id;

      // Store customer ID in database
      await this.db.query(
        'UPDATE users SET lemonsqueezy_customer_id = ? WHERE id = ?',
        [customerId, user.id]
      );

      this.logger.info(`LemonSqueezy customer created: ${customerId} for user ${user.id}`);
      return customerId;
    } catch (error) {
      this.logger.error('Failed to create LemonSqueezy customer:', error);
      throw new FlowmatikError('Failed to create payment account', 'PAYMENT_SETUP_ERROR');
    }
  }

  /**
   * Create subscription with Stripe
   */
  async createStripeSubscription(
    userId: string,
    priceId: string,
    paymentMethodId?: string
  ): Promise<{ subscription: Subscription; clientSecret?: string }> {
    try {
      // Get or create customer
      let customerId = await this.getStripeCustomerId(userId);
      if (!customerId) {
        const user = await this.getUserById(userId);
        customerId = await this.createStripeCustomer(user);
      }

      // Attach payment method if provided
      if (paymentMethodId) {
        await this.stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId
        });

        // Set as default payment method
        await this.stripe.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId
          }
        });
      }

      // Create subscription
      const stripeSubscription = await this.stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          userId,
          source: 'flowmatik'
        }
      });

      // Map Stripe price to our plan
      const plan = this.mapStripePriceToPlan(priceId);

      // Create subscription in our database
      const subscription = await this.createSubscriptionRecord({
        userId,
        plan,
        status: stripeSubscription.status as any,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        stripeSubscriptionId: stripeSubscription.id,
        metadata: {
          priceId,
          customerId
        }
      });

      // Get client secret for payment confirmation
      const latestInvoice = stripeSubscription.latest_invoice as Stripe.Invoice;
      const paymentIntent = latestInvoice?.payment_intent as Stripe.PaymentIntent;
      const clientSecret = paymentIntent?.client_secret;

      this.logger.info(`Stripe subscription created: ${stripeSubscription.id} for user ${userId}`);

      return { subscription, clientSecret };
    } catch (error) {
      this.logger.error('Failed to create Stripe subscription:', error);
      throw new FlowmatikError('Failed to create subscription', 'SUBSCRIPTION_CREATION_ERROR');
    }
  }

  /**
   * Create subscription with LemonSqueezy
   */
  async createLemonSqueezySubscription(
    userId: string,
    variantId: string
  ): Promise<{ subscription: Subscription; checkoutUrl: string }> {
    try {
      // Get or create customer
      let customerId = await this.getLemonSqueezyCustomerId(userId);
      if (!customerId) {
        const user = await this.getUserById(userId);
        customerId = await this.createLemonSqueezyCustomer(user);
      }

      // Create checkout
      const response = await this.lemonSqueezy.client.post('/checkouts', {
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              custom: {
                user_id: userId
              }
            }
          },
          relationships: {
            store: {
              data: {
                type: 'stores',
                id: process.env.LEMONSQUEEZY_STORE_ID
              }
            },
            variant: {
              data: {
                type: 'variants',
                id: variantId
              }
            }
          }
        }
      });

      const checkout = response.data.data;
      const checkoutUrl = checkout.attributes.url;

      // Map variant to our plan
      const plan = this.mapLemonSqueezyVariantToPlan(variantId);

      // Create pending subscription record
      const subscription = await this.createSubscriptionRecord({
        userId,
        plan,
        status: 'pending',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        lemonSqueezySubscriptionId: checkout.id,
        metadata: {
          variantId,
          checkoutId: checkout.id
        }
      });

      this.logger.info(`LemonSqueezy checkout created: ${checkout.id} for user ${userId}`);

      return { subscription, checkoutUrl };
    } catch (error) {
      this.logger.error('Failed to create LemonSqueezy subscription:', error);
      throw new FlowmatikError('Failed to create subscription', 'SUBSCRIPTION_CREATION_ERROR');
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId: string, immediately: boolean = false): Promise<void> {
    try {
      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription) {
        throw new FlowmatikError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
      }

      if (subscription.stripeSubscriptionId) {
        // Cancel Stripe subscription
        await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: !immediately
        });

        if (immediately) {
          await this.stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
        }
      } else if (subscription.lemonSqueezySubscriptionId) {
        // Cancel LemonSqueezy subscription
        await this.lemonSqueezy.client.delete(
          `/subscriptions/${subscription.lemonSqueezySubscriptionId}`
        );
      }

      // Update subscription in database
      await this.db.query(
        `UPDATE subscriptions 
         SET status = ?, cancel_at_period_end = ?, updated_at = NOW()
         WHERE id = ?`,
        [immediately ? 'cancelled' : 'active', !immediately, subscriptionId]
      );

      this.logger.info(`Subscription cancelled: ${subscriptionId}`);
    } catch (error) {
      this.logger.error('Failed to cancel subscription:', error);
      throw new FlowmatikError('Failed to cancel subscription', 'SUBSCRIPTION_CANCELLATION_ERROR');
    }
  }

  /**
   * Update subscription plan
   */
  async updateSubscriptionPlan(
    subscriptionId: string,
    newPriceId: string
  ): Promise<Subscription> {
    try {
      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription) {
        throw new FlowmatikError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
      }

      if (subscription.stripeSubscriptionId) {
        // Update Stripe subscription
        const stripeSubscription = await this.stripe.subscriptions.retrieve(
          subscription.stripeSubscriptionId
        );

        await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          items: [{
            id: stripeSubscription.items.data[0].id,
            price: newPriceId
          }],
          proration_behavior: 'create_prorations'
        });

        // Update plan in database
        const newPlan = this.mapStripePriceToPlan(newPriceId);
        await this.db.query(
          'UPDATE subscriptions SET plan = ?, updated_at = NOW() WHERE id = ?',
          [newPlan, subscriptionId]
        );
      }

      const updatedSubscription = await this.getSubscriptionById(subscriptionId);
      this.logger.info(`Subscription plan updated: ${subscriptionId} to ${newPriceId}`);

      return updatedSubscription!;
    } catch (error) {
      this.logger.error('Failed to update subscription plan:', error);
      throw new FlowmatikError('Failed to update subscription', 'SUBSCRIPTION_UPDATE_ERROR');
    }
  }

  /**
   * Add payment method
   */
  async addPaymentMethod(
    userId: string,
    paymentMethodId: string,
    setAsDefault: boolean = false
  ): Promise<PaymentMethod> {
    try {
      let customerId = await this.getStripeCustomerId(userId);
      if (!customerId) {
        const user = await this.getUserById(userId);
        customerId = await this.createStripeCustomer(user);
      }

      // Attach payment method to customer
      const paymentMethod = await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId
      });

      // Set as default if requested
      if (setAsDefault) {
        await this.stripe.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId
          }
        });
      }

      // Store in database
      const [result] = await this.db.query(
        `INSERT INTO payment_methods 
         (user_id, stripe_payment_method_id, type, last4, brand, expiry_month, expiry_year, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          userId,
          paymentMethodId,
          paymentMethod.type,
          paymentMethod.card?.last4,
          paymentMethod.card?.brand,
          paymentMethod.card?.exp_month,
          paymentMethod.card?.exp_year,
          setAsDefault
        ]
      );

      // If set as default, update other payment methods
      if (setAsDefault) {
        await this.db.query(
          'UPDATE payment_methods SET is_default = false WHERE user_id = ? AND id != ?',
          [userId, result.id]
        );
      }

      this.logger.info(`Payment method added: ${paymentMethodId} for user ${userId}`);

      return {
        id: result.id,
        userId,
        type: paymentMethod.type as any,
        last4: paymentMethod.card?.last4,
        brand: paymentMethod.card?.brand,
        expiryMonth: paymentMethod.card?.exp_month,
        expiryYear: paymentMethod.card?.exp_year,
        isDefault: setAsDefault,
        stripePaymentMethodId: paymentMethodId
      };
    } catch (error) {
      this.logger.error('Failed to add payment method:', error);
      throw new FlowmatikError('Failed to add payment method', 'PAYMENT_METHOD_ERROR');
    }
  }

  /**
   * Remove payment method
   */
  async removePaymentMethod(paymentMethodId: string): Promise<void> {
    try {
      // Get payment method from database
      const [paymentMethod] = await this.db.query(
        'SELECT * FROM payment_methods WHERE id = ?',
        [paymentMethodId]
      );

      if (!paymentMethod) {
        throw new FlowmatikError('Payment method not found', 'PAYMENT_METHOD_NOT_FOUND');
      }

      // Detach from Stripe
      if (paymentMethod.stripe_payment_method_id) {
        await this.stripe.paymentMethods.detach(paymentMethod.stripe_payment_method_id);
      }

      // Remove from database
      await this.db.query(
        'DELETE FROM payment_methods WHERE id = ?',
        [paymentMethodId]
      );

      this.logger.info(`Payment method removed: ${paymentMethodId}`);
    } catch (error) {
      this.logger.error('Failed to remove payment method:', error);
      throw new FlowmatikError('Failed to remove payment method', 'PAYMENT_METHOD_ERROR');
    }
  }

  /**
   * Get user's payment methods
   */
  async getPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    const paymentMethods = await this.db.query(
      'SELECT * FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
      [userId]
    );

    return paymentMethods.map(pm => ({
      id: pm.id,
      userId: pm.user_id,
      type: pm.type,
      last4: pm.last4,
      brand: pm.brand,
      expiryMonth: pm.expiry_month,
      expiryYear: pm.expiry_year,
      isDefault: pm.is_default,
      stripePaymentMethodId: pm.stripe_payment_method_id
    }));
  }

  /**
   * Get user's subscription
   */
  async getUserSubscription(userId: string): Promise<Subscription | null> {
    const [subscription] = await this.db.query(
      'SELECT * FROM subscriptions WHERE user_id = ? AND status IN ("active", "past_due") ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (!subscription) return null;

    return {
      id: subscription.id,
      userId: subscription.user_id,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start),
      currentPeriodEnd: new Date(subscription.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      stripeSubscriptionId: subscription.stripe_subscription_id,
      lemonSqueezySubscriptionId: subscription.lemonsqueezy_subscription_id,
      metadata: subscription.metadata ? JSON.parse(subscription.metadata) : {}
    };
  }

  /**
   * Get invoices for user
   */
  async getUserInvoices(userId: string, limit: number = 10): Promise<Invoice[]> {
    const invoices = await this.db.query(
      'SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, limit]
    );

    return invoices.map(invoice => ({
      id: invoice.id,
      userId: invoice.user_id,
      subscriptionId: invoice.subscription_id,
      amount: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
      dueDate: new Date(invoice.due_date),
      paidAt: invoice.paid_at ? new Date(invoice.paid_at) : undefined,
      items: invoice.items ? JSON.parse(invoice.items) : [],
      metadata: invoice.metadata ? JSON.parse(invoice.metadata) : {}
    }));
  }

  /**
   * Process usage-based billing
   */
  async processUsageBilling(userId: string, usage: {
    requests: number;
    tokens: number;
    cost: number;
  }): Promise<void> {
    try {
      const subscription = await this.getUserSubscription(userId);
      if (!subscription || subscription.plan === 'free') {
        return; // No billing for free plan
      }

      // Check if usage exceeds plan limits
      const planLimits = this.getPlanLimits(subscription.plan);
      
      if (planLimits.requests !== -1 && usage.requests > planLimits.requests) {
        // Create overage charge
        const overageRequests = usage.requests - planLimits.requests;
        const overageCost = overageRequests * planLimits.overageRate;

        await this.createUsageInvoice(userId, subscription.id, {
          description: `Overage charges for ${overageRequests} requests`,
          amount: overageCost,
          period: new Date()
        });
      }

      this.logger.info(`Usage billing processed for user ${userId}: ${usage.cost}`);
    } catch (error) {
      this.logger.error('Failed to process usage billing:', error);
    }
  }

  // Private helper methods

  private async getStripeCustomerId(userId: string): Promise<string | null> {
    const [user] = await this.db.query(
      'SELECT stripe_customer_id FROM users WHERE id = ?',
      [userId]
    );
    return user?.stripe_customer_id || null;
  }

  private async getLemonSqueezyCustomerId(userId: string): Promise<string | null> {
    const [user] = await this.db.query(
      'SELECT lemonsqueezy_customer_id FROM users WHERE id = ?',
      [userId]
    );
    return user?.lemonsqueezy_customer_id || null;
  }

  private async getUserById(userId: string): Promise<User> {
    const [user] = await this.db.query(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    
    if (!user) {
      throw new FlowmatikError('User not found', 'USER_NOT_FOUND');
    }

    return user;
  }

  private async getSubscriptionById(subscriptionId: string): Promise<Subscription | null> {
    const [subscription] = await this.db.query(
      'SELECT * FROM subscriptions WHERE id = ?',
      [subscriptionId]
    );

    if (!subscription) return null;

    return {
      id: subscription.id,
      userId: subscription.user_id,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start),
      currentPeriodEnd: new Date(subscription.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      stripeSubscriptionId: subscription.stripe_subscription_id,
      lemonSqueezySubscriptionId: subscription.lemonsqueezy_subscription_id,
      metadata: subscription.metadata ? JSON.parse(subscription.metadata) : {}
    };
  }

  private async createSubscriptionRecord(data: {
    userId: string;
    plan: string;
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    stripeSubscriptionId?: string;
    lemonSqueezySubscriptionId?: string;
    metadata?: any;
  }): Promise<Subscription> {
    const [result] = await this.db.query(
      `INSERT INTO subscriptions 
       (user_id, plan, status, current_period_start, current_period_end, 
        stripe_subscription_id, lemonsqueezy_subscription_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
       RETURNING id`,
      [
        data.userId,
        data.plan,
        data.status,
        data.currentPeriodStart,
        data.currentPeriodEnd,
        data.stripeSubscriptionId,
        data.lemonSqueezySubscriptionId,
        JSON.stringify(data.metadata || {})
      ]
    );

    return {
      id: result.id,
      userId: data.userId,
      plan: data.plan as any,
      status: data.status as any,
      currentPeriodStart: data.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd,
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: data.stripeSubscriptionId,
      lemonSqueezySubscriptionId: data.lemonSqueezySubscriptionId,
      metadata: data.metadata || {}
    };
  }

  private async createUsageInvoice(
    userId: string,
    subscriptionId: string,
    data: {
      description: string;
      amount: number;
      period: Date;
    }
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO invoices 
       (user_id, subscription_id, amount, currency, status, due_date, items, created_at)
       VALUES (?, ?, ?, 'USD', 'open', DATE_ADD(NOW(), INTERVAL 7 DAY), ?, NOW())`,
      [
        userId,
        subscriptionId,
        data.amount,
        JSON.stringify([{
          description: data.description,
          quantity: 1,
          unitPrice: data.amount,
          amount: data.amount
        }])
      ]
    );
  }

  private mapStripePriceToPlan(priceId: string): string {
    const priceMapping: Record<string, string> = {
      'price_starter_monthly': 'starter',
      'price_pro_monthly': 'pro',
      'price_business_monthly': 'business',
      'price_starter_yearly': 'starter',
      'price_pro_yearly': 'pro',
      'price_business_yearly': 'business'
    };
    return priceMapping[priceId] || 'starter';
  }

  private mapLemonSqueezyVariantToPlan(variantId: string): string {
    const variantMapping: Record<string, string> = {
      'variant_starter': 'starter',
      'variant_pro': 'pro',
      'variant_business': 'business'
    };
    return variantMapping[variantId] || 'starter';
  }

  private getPlanLimits(plan: string) {
    const limits = {
      starter: { requests: 1000, tokens: 500000, overageRate: 0.01 },
      pro: { requests: 10000, tokens: 5000000, overageRate: 0.008 },
      business: { requests: -1, tokens: -1, overageRate: 0.005 }
    };
    return limits[plan as keyof typeof limits] || limits.starter;
  }
}

