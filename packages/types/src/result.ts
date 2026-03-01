export type Result<E, A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };

export const ok = <A>(value: A): Result<never, A> => ({ ok: true, value });

export const err = <E>(error: E): Result<E, never> => ({ ok: false, error });

export const map = <E, A, B>(
  r: Result<E, A>,
  f: (a: A) => B,
): Result<E, B> => (r.ok ? ok(f(r.value)) : r);

export const flatMap = <E, A, B>(
  r: Result<E, A>,
  f: (a: A) => Result<E, B>,
): Result<E, B> => (r.ok ? f(r.value) : r);

export const mapError = <E, F, A>(
  r: Result<E, A>,
  f: (e: E) => F,
): Result<F, A> => (r.ok ? r : err(f(r.error)));

export const unwrap = <E, A>(r: Result<E, A>): A => {
  if (r.ok) return r.value;
  throw new Error(`unwrap called on err: ${JSON.stringify(r.error)}`);
};

export const unwrapOr = <E, A>(r: Result<E, A>, fallback: A): A =>
  r.ok ? r.value : fallback;

export const fromTryCatch = <E, A>(
  f: () => A,
  onError: (e: unknown) => E,
): Result<E, A> => {
  try {
    return ok(f());
  } catch (e) {
    return err(onError(e));
  }
};
