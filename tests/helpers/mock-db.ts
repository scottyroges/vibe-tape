import { vi } from "vitest";

/**
 * Creates a chainable mock that mimics Kysely's fluent query builder API.
 * Every method returns the same proxy, except terminal methods (execute,
 * executeTakeFirst, executeTakeFirstOrThrow) which are vi.fn() stubs
 * you can configure with mockResolvedValue.
 *
 * Entry-point methods (selectFrom, insertInto, updateTable, deleteFrom) are
 * also vi.fn() spies so tests can verify which table each query targets.
 */
export function createMockDb() {
  const execute = vi.fn();
  const executeTakeFirst = vi.fn();
  const executeTakeFirstOrThrow = vi.fn();

  const selectFrom = vi.fn();
  const insertInto = vi.fn();
  const updateTable = vi.fn();
  const deleteFrom = vi.fn();
  const where = vi.fn();
  const set = vi.fn();
  const values = vi.fn();

  const builder: Record<string, unknown> = {};

  const fn = {
    countAll: () => ({
      as: () => "count_placeholder",
    }),
  };

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "fn") return fn;
      if (prop === "transaction")
        return () => ({
          execute: async (cb: (trx: unknown) => Promise<void>) => cb(proxy),
        });
      if (prop === "execute") return execute;
      if (prop === "executeTakeFirst") return executeTakeFirst;
      if (prop === "executeTakeFirstOrThrow") return executeTakeFirstOrThrow;
      if (prop === "selectFrom")
        return (...args: unknown[]) => {
          selectFrom(...args);
          return proxy;
        };
      if (prop === "insertInto")
        return (...args: unknown[]) => {
          insertInto(...args);
          return proxy;
        };
      if (prop === "updateTable")
        return (...args: unknown[]) => {
          updateTable(...args);
          return proxy;
        };
      if (prop === "deleteFrom")
        return (...args: unknown[]) => {
          deleteFrom(...args);
          return proxy;
        };
      if (prop === "where")
        return (...args: unknown[]) => {
          where(...args);
          return proxy;
        };
      if (prop === "set")
        return (...args: unknown[]) => {
          set(...args);
          return proxy;
        };
      if (prop === "values")
        return (...args: unknown[]) => {
          values(...args);
          return proxy;
        };
      // Return a function that returns the proxy for chaining
      return () => proxy;
    },
  };

  const proxy = new Proxy(builder, handler);

  return {
    /** The mock db — pass this as `db` in your mock factory. */
    db: proxy,
    /** Stub for `.execute()` */
    execute,
    /** Stub for `.executeTakeFirst()` */
    executeTakeFirst,
    /** Stub for `.executeTakeFirstOrThrow()` */
    executeTakeFirstOrThrow,
    /** Spy for `.selectFrom(table)` */
    selectFrom,
    /** Spy for `.insertInto(table)` */
    insertInto,
    /** Spy for `.updateTable(table)` */
    updateTable,
    /** Spy for `.deleteFrom(table)` */
    deleteFrom,
    /** Spy for `.where(column, op, value)` */
    where,
    /** Spy for `.set(obj)` — captures the UPDATE payload */
    set,
    /** Spy for `.values(obj)` — captures the INSERT payload */
    values,
  };
}
