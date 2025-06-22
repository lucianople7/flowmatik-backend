import crypto from 'crypto';
import Stripe from 'stripe';
import { DatabaseService } from './databaseService';
import { PaymentService } from './paymentService';
import { Logger } from '../utils/logger';
import { WebhookEvent, FlowmatikError } from '../types';

export class WebhookService {
  private db: DatabaseService;
  private paymentService: PaymentService;
  private logger: Logger;
  private stripeWebhookSecret: string;
  private lemonSqueezyWebhookSecret: string;

  constructor(
    db: DatabaseService,
    paymentService: PaymentService,
    config: {
      stripeWebhookSecret: string;
      lemonSqueezyWebhookSecret: string;
    }
  ) {
    this.db = db;
    this.paymentService = paymentService;
    this.logger = new Logger('WebhookService');
    this.stripeWebhookSecret = config.stripeWebhookSecret;
    this.lemonSqueezyWebhookSecret = config.lemonSqueezyWebhookSecret;
  }

  /**
   * Handle Stripe webhook
   */
  async handleStripeWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<{ received: boolean; processed: boolean }> {
    try {
      // Verify webhook signature
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-10-16'
      });

      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        this.stripeWebhookSecret
      );

      // Store webhook event
      const webhookEvent = await this.storeWebhookEvent({
        id: event.id,
        type: event.type,
        data: event.data,
        timestamp: new Date(event.created * 1000),
        source: 'stripe'
      });

      // Process the event
      const processed = await this.processStripeEvent(event);

      // Update webhook event status
      await this.updateWebhookEventStatus(webhookEvent.id, processed, null);

      this.logger.info(`Stripe webhook processed: ${event.type} - ${event.id}`);

      return { received: true, processed };
    } catch (error) {
      this.logger.error('Failed to handle Stripe webhook:', error);
      
      if (error instanceof Error) {
        // Store failed webhook for retry
        await this.storeWebhookEvent({
          id: `failed_${Date.now()}`,
          type: 'webhook_failed',
          data: { payload: payload.toString(), signature },
          timestamp: new Date(),
          source: 'stripe',
          error: error.message
        });
      }

      throw new FlowmatikError('Webhook processing failed', 'WEBHOOK_ERROR');
    }
  }

  /**
   * Handle LemonSqueezy webhook
   */
  async handleLemonSqueezyWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<{ received: boolean; processed: boolean }> {
    try {
      // Verify webhook signature
      const expectedSignature = crypto
        .createHmac('sha256', this.lemonSqueezyWebhookSecret)
        .update(payload)
        .digest('hex');

      if (signature !== expectedSignature) {
        throw new Error('Invalid webhook signature');
      }

      const eventData = JSON.parse(payload.toString());

      // Store webhook event
      const webhookEvent = await this.storeWebhookEvent({
        id: eventData.meta.event_name + '_' + Date.now(),
        type: eventData.meta.event_name,
        data: eventData.data,
        timestamp: new Date(),
        source: 'lemon_squeezy'
      });

      // Process the event
      const processed = await this.processLemonSqueezyEvent(eventData);

      // Update webhook event status
      await this.updateWebhookEventStatus(webhookEvent.id, processed, null);

      this.logger.info(`LemonSqueezy webhook processed: ${eventData.meta.event_name}`);

      return { received: true, processed };
    } catch (error) {
      this.logger.error('Failed to handle LemonSqueezy webhook:', error);
      
      if (error instanceof Error) {
        // Store failed webhook for retry
        await this.storeWebhookEvent({
          id: `failed_${Date.now()}`,
          type: 'webhook_failed',
          data: { payload: payload.toString(), signature },
          timestamp: new Date(),
          source: 'lemon_squeezy',
          error: error.message
        });
      }

      throw new FlowmatikError('Webhook processing failed', 'WEBHOOK_ERROR');
    }
  }

  /**
   * Process Stripe events
   */
  private async processStripeEvent(event: Stripe.Event): Promise<boolean> {
    try {
      switch (event.type) {
        case 'customer.subscription.created':
          return await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);

        case 'customer.subscription.updated':
          return await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);

        case 'customer.subscription.deleted':
          return await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);

        case 'invoice.payment_succeeded':
          return await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);

        case 'invoice.payment_failed':
          return await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);

        case 'customer.subscription.trial_will_end':
          return await this.handleTrialWillEnd(event.data.object as Stripe.Subscription);

        case 'payment_method.attached':
          return await this.handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);

        case 'payment_method.detached':
          return await this.handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);

        default:
          this.logger.info(`Unhandled Stripe event type: ${event.type}`);
          return true; // Mark as processed even if not handled
      }
    } catch (error) {
      this.logger.error(`Failed to process Stripe event ${event.type}:`, error);
      return false;
    }
  }

  /**
   * Process LemonSqueezy events
   */
  private async processLemonSqueezyEvent(eventData: any): Promise<boolean> {
    try {
      const eventType = eventData.meta.event_name;

      switch (eventType) {
        case 'subscription_created':
          return await this.handleLemonSqueezySubscriptionCreated(eventData.data);

        case 'subscription_updated':
          return await this.handleLemonSqueezySubscriptionUpdated(eventData.data);

        case 'subscription_cancelled':
          return await this.handleLemonSqueezySubscriptionCancelled(eventData.data);

        case 'subscription_resumed':
          return await this.handleLemonSqueezySubscriptionResumed(eventData.data);

        case 'subscription_expired':
          return await this.handleLemonSqueezySubscriptionExpired(eventData.data);

        case 'subscription_payment_success':
          return await this.handleLemonSqueezyPaymentSuccess(eventData.data);

        case 'subscription_payment_failed':
          return await this.handleLemonSqueezyPaymentFailed(eventData.data);

        default:
          this.logger.info(`Unhandled LemonSqueezy event type: ${eventType}`);
          return true;
      }
    } catch (error) {
      this.logger.error(`Failed to process LemonSqueezy event ${eventData.meta.event_name}:`, error);
      return false;
    }
  }

  // Stripe event handlers

  private async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<boolean> {
    const userId = subscription.metadata.userId;
    if (!userId) {
      this.logger.warn('Subscription created without userId metadata');
      return false;
    }

    await this.db.query(
      `UPDATE subscriptions 
       SET status = ?, current_period_start = ?, current_period_end = ?
       WHERE stripe_subscription_id = ?`,
      [
        subscription.status,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
        subscription.id
      ]
    );

    this.logger.info(`Subscription activated for user ${userId}: ${subscription.id}`);
    return true;
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<boolean> {
    await this.db.query(
      `UPDATE subscriptions 
       SET status = ?, current_period_start = ?, current_period_end = ?, 
           cancel_at_period_end = ?
       WHERE stripe_subscription_id = ?`,
      [
        subscription.status,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
        subscription.cancel_at_period_end,
        subscription.id
      ]
    );

    this.logger.info(`Subscription updated: ${subscription.id}`);
    return true;
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<boolean> {
    await this.db.query(
      'UPDATE subscriptions SET status = ? WHERE stripe_subscription_id = ?',
      ['cancelled', subscription.id]
    );

    // Downgrade user to free plan
    const [sub] = await this.db.query(
      'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?',
      [subscription.id]
    );

    if (sub) {
      await this.createFreeSubscription(sub.user_id);
    }

    this.logger.info(`Subscription cancelled: ${subscription.id}`);
    return true;
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<boolean> {
    if (invoice.subscription) {
      // Update subscription status
      await this.db.query(
        'UPDATE subscriptions SET status = ? WHERE stripe_subscription_id = ?',
        ['active', invoice.subscription]
      );

      // Create invoice record
      await this.createInvoiceRecord(invoice, 'paid');
    }

    this.logger.info(`Invoice payment succeeded: ${invoice.id}`);
    return true;
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<boolean> {
    if (invoice.subscription) {
      // Update subscription status
      await this.db.query(
        'UPDATE subscriptions SET status = ? WHERE stripe_subscription_id = ?',
        ['past_due', invoice.subscription]
      );

      // Create invoice record
      await this.createInvoiceRecord(invoice, 'payment_failed');

      // TODO: Send payment failed notification
    }

    this.logger.info(`Invoice payment failed: ${invoice.id}`);
    return true;
  }

  private async handleTrialWillEnd(subscription: Stripe.Subscription): Promise<boolean> {
    const userId = subscription.metadata.userId;
    if (userId) {
      // TODO: Send trial ending notification
      this.logger.info(`Trial ending soon for user ${userId}`);
    }
    return true;
  }

  private async handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod): Promise<boolean> {
    // Payment method handling is done in PaymentService
    this.logger.info(`Payment method attached: ${paymentMethod.id}`);
    return true;
  }

  private async handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod): Promise<boolean> {
    // Remove from database
    await this.db.query(
      'DELETE FROM payment_methods WHERE stripe_payment_method_id = ?',
      [paymentMethod.id]
    );

    this.logger.info(`Payment method detached: ${paymentMethod.id}`);
    return true;
  }

  // LemonSqueezy event handlers

  private async handleLemonSqueezySubscriptionCreated(data: any): Promise<boolean> {
    const userId = data.attributes.custom_data?.user_id;
    if (!userId) {
      this.logger.warn('LemonSqueezy subscription created without user_id');
      return false;
    }

    await this.db.query(
      `UPDATE subscriptions 
       SET status = ?, current_period_start = ?, current_period_end = ?
       WHERE lemonsqueezy_subscription_id = ?`,
      [
        'active',
        new Date(data.attributes.created_at),
        new Date(data.attributes.renews_at),
        data.id
      ]
    );

    this.logger.info(`LemonSqueezy subscription created for user ${userId}: ${data.id}`);
    return true;
  }

  private async handleLemonSqueezySubscriptionUpdated(data: any): Promise<boolean> {
    await this.db.query(
      `UPDATE subscriptions 
       SET status = ?, current_period_end = ?
       WHERE lemonsqueezy_subscription_id = ?`,
      [
        data.attributes.status,
        new Date(data.attributes.renews_at),
        data.id
      ]
    );

    this.logger.info(`LemonSqueezy subscription updated: ${data.id}`);
    return true;
  }

  private async handleLemonSqueezySubscriptionCancelled(data: any): Promise<boolean> {
    await this.db.query(
      'UPDATE subscriptions SET status = ?, cancel_at_period_end = true WHERE lemonsqueezy_subscription_id = ?',
      ['cancelled', data.id]
    );

    this.logger.info(`LemonSqueezy subscription cancelled: ${data.id}`);
    return true;
  }

  private async handleLemonSqueezySubscriptionResumed(data: any): Promise<boolean> {
    await this.db.query(
      'UPDATE subscriptions SET status = ?, cancel_at_period_end = false WHERE lemonsqueezy_subscription_id = ?',
      ['active', data.id]
    );

    this.logger.info(`LemonSqueezy subscription resumed: ${data.id}`);
    return true;
  }

  private async handleLemonSqueezySubscriptionExpired(data: any): Promise<boolean> {
    await this.db.query(
      'UPDATE subscriptions SET status = ? WHERE lemonsqueezy_subscription_id = ?',
      ['expired', data.id]
    );

    // Downgrade to free plan
    const [sub] = await this.db.query(
      'SELECT user_id FROM subscriptions WHERE lemonsqueezy_subscription_id = ?',
      [data.id]
    );

    if (sub) {
      await this.createFreeSubscription(sub.user_id);
    }

    this.logger.info(`LemonSqueezy subscription expired: ${data.id}`);
    return true;
  }

  private async handleLemonSqueezyPaymentSuccess(data: any): Promise<boolean> {
    // Create invoice record for successful payment
    this.logger.info(`LemonSqueezy payment succeeded: ${data.id}`);
    return true;
  }

  private async handleLemonSqueezyPaymentFailed(data: any): Promise<boolean> {
    // Handle failed payment
    this.logger.info(`LemonSqueezy payment failed: ${data.id}`);
    return true;
  }

  // Helper methods

  private async storeWebhookEvent(event: {
    id: string;
    type: string;
    data: any;
    timestamp: Date;
    source: 'stripe' | 'lemon_squeezy';
    error?: string;
  }): Promise<WebhookEvent> {
    const [result] = await this.db.query(
      `INSERT INTO webhook_events 
       (id, type, data, timestamp, source, processed, attempts, error)
       VALUES (?, ?, ?, ?, ?, false, 0, ?)
       RETURNING *`,
      [
        event.id,
        event.type,
        JSON.stringify(event.data),
        event.timestamp,
        event.source,
        event.error || null
      ]
    );

    return {
      id: result.id,
      type: result.type,
      data: JSON.parse(result.data),
      timestamp: new Date(result.timestamp),
      source: result.source,
      processed: result.processed,
      attempts: result.attempts,
      lastAttempt: result.last_attempt ? new Date(result.last_attempt) : undefined,
      error: result.error
    };
  }

  private async updateWebhookEventStatus(
    eventId: string,
    processed: boolean,
    error: string | null
  ): Promise<void> {
    await this.db.query(
      `UPDATE webhook_events 
       SET processed = ?, attempts = attempts + 1, last_attempt = NOW(), error = ?
       WHERE id = ?`,
      [processed, error, eventId]
    );
  }

  private async createInvoiceRecord(invoice: Stripe.Invoice, status: string): Promise<void> {
    const [subscription] = await this.db.query(
      'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?',
      [invoice.subscription]
    );

    if (subscription) {
      await this.db.query(
        `INSERT INTO invoices 
         (user_id, subscription_id, amount, currency, status, due_date, paid_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          subscription.user_id,
          subscription.id,
          invoice.amount_paid / 100, // Convert from cents
          invoice.currency,
          status,
          new Date(invoice.due_date! * 1000),
          invoice.status_transitions.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : null,
          JSON.stringify({ stripeInvoiceId: invoice.id })
        ]
      );
    }
  }

  private async createFreeSubscription(userId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO subscriptions 
       (user_id, plan, status, current_period_start, current_period_end)
       VALUES (?, 'free', 'active', NOW(), DATE_ADD(NOW(), INTERVAL 1 YEAR))`,
      [userId]
    );
  }

  /**
   * Retry failed webhooks
   */
  async retryFailedWebhooks(): Promise<number> {
    const failedEvents = await this.db.query(
      `SELECT * FROM webhook_events 
       WHERE processed = false AND attempts < 3 
       AND last_attempt < DATE_SUB(NOW(), INTERVAL 1 HOUR)
       ORDER BY timestamp ASC
       LIMIT 10`
    );

    let retried = 0;

    for (const event of failedEvents) {
      try {
        let processed = false;

        if (event.source === 'stripe') {
          processed = await this.processStripeEvent({
            id: event.id,
            type: event.type,
            data: JSON.parse(event.data),
            created: Math.floor(event.timestamp.getTime() / 1000)
          } as any);
        } else if (event.source === 'lemon_squeezy') {
          processed = await this.processLemonSqueezyEvent({
            meta: { event_name: event.type },
            data: JSON.parse(event.data)
          });
        }

        await this.updateWebhookEventStatus(event.id, processed, null);
        retried++;
      } catch (error) {
        await this.updateWebhookEventStatus(
          event.id,
          false,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }

    if (retried > 0) {
      this.logger.info(`Retried ${retried} failed webhooks`);
    }

    return retried;
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStats(): Promise<{
    total: number;
    processed: number;
    failed: number;
    bySource: Record<string, number>;
    recentEvents: WebhookEvent[];
  }> {
    const [stats] = await this.db.query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN processed = true THEN 1 ELSE 0 END) as processed,
         SUM(CASE WHEN processed = false THEN 1 ELSE 0 END) as failed
       FROM webhook_events`
    );

    const bySource = await this.db.query(
      'SELECT source, COUNT(*) as count FROM webhook_events GROUP BY source'
    );

    const recentEvents = await this.db.query(
      'SELECT * FROM webhook_events ORDER BY timestamp DESC LIMIT 10'
    );

    return {
      total: stats.total || 0,
      processed: stats.processed || 0,
      failed: stats.failed || 0,
      bySource: bySource.reduce((acc: any, row: any) => {
        acc[row.source] = row.count;
        return acc;
      }, {}),
      recentEvents: recentEvents.map((event: any) => ({
        id: event.id,
        type: event.type,
        data: JSON.parse(event.data),
        timestamp: new Date(event.timestamp),
        source: event.source,
        processed: event.processed,
        attempts: event.attempts,
        lastAttempt: event.last_attempt ? new Date(event.last_attempt) : undefined,
        error: event.error
      }))
    };
  }
}

