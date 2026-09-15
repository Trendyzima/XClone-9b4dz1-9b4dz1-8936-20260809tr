import type { ClientServerOptions } from '@supabase/postgrest-js';

declare module '@supabase/postgrest-js' {
  interface PostgrestBuilder<
    ClientOptions extends ClientServerOptions,
    Result,
    ThrowOnError extends boolean = false,
  > {
    catch<TResult = never>(
      onRejected?: (reason: any) => TResult | PromiseLike<TResult>,
    ): PromiseLike<TResult>;
  }
}
