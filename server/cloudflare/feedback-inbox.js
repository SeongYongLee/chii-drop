import { DurableObject } from 'cloudflare:workers';
import { createFeedbackStore } from '../feedback.js';

export class FeedbackInbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = createFeedbackStore((query, ...params) => ctx.storage.sql.exec(query, ...params).toArray());
  }
  save(entry) { return this.store.save(entry); }
  list(before) { return this.store.list(before); }
  remove(id) { this.store.remove(id); }
}
