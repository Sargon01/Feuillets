/**
 * Public Citation Engine API for Feuillets.
 *
 * Minimal surface: Feuillets does not implement a citation engine directly.
 * It provides a public registry for optional companion plugins (e.g. Feuillets CSL)
 * to dynamically register, unregister, or reload citation providers.
 *
 * This contract contains no Obsidian dependencies and is pure TypeScript.
 */

/** Minimal public interface for a citation engine provider. */
export interface CitationEngineProvider {
  /** Unique provider identifier, e.g. "feuillets-csl". */
  id: string;
  /** Display name of the provider. */
  name: string;
  /** Semantic version string of the provider. */
  version: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates whether an arbitrary value conforms to CitationEngineProvider.
 * Third-party companion plugins are compiled separately, so runtime checks
 * are necessary to guarantee structural integrity.
 */
export function isCitationEngineProvider(value: unknown): value is CitationEngineProvider {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    isNonEmptyString(value["name"]) &&
    isNonEmptyString(value["version"])
  );
}

/**
 * Registry for citation engine providers.
 *
 * Re-registering the same provider ID replaces the previous instance instead of failing,
 * ensuring seamless reload cycles when companion plugins are updated or reloaded by Obsidian.
 */
export class CitationEngineRegistry {
  private providers = new Map<string, CitationEngineProvider>();
  private listeners = new Set<() => void>();

  register(provider: CitationEngineProvider): void {
    if (!isCitationEngineProvider(provider)) {
      throw new Error(
        "Feuillets: invalid citation engine provider (id, name, and version are required non-empty strings)."
      );
    }
    this.providers.set(provider.id, provider);
    this.emit();
  }

  /**
   * Unregisters a provider by its identifier.
   * Returns true if a provider was removed, false otherwise.
   * Never throws so companion plugins can safely call this in onunload().
   */
  unregister(providerId: string): boolean {
    const removed = this.providers.delete(providerId);
    if (removed) this.emit();
    return removed;
  }

  /**
   * Retrieves a provider by ID, or the first registered provider if omitted.
   * Returns null if no matching provider is registered.
   */
  get(providerId?: string): CitationEngineProvider | null {
    if (providerId !== undefined) return this.providers.get(providerId) ?? null;
    for (const provider of this.providers.values()) return provider;
    return null;
  }

  /** Lists all registered providers. */
  list(): CitationEngineProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Registers a callback invoked whenever providers are registered or unregistered.
   * Returns an unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Faulty listeners must not disrupt the registry. */
      }
    }
  }
}

/**
 * Namespaced citation API exposed on plugin.api.citations.
 */
export interface FeuilletsCitationApi {
  readonly apiVersion: number;
  registerProvider(provider: CitationEngineProvider): void;
  unregisterProvider(providerId: string): void;
  getProvider(providerId?: string): CitationEngineProvider | null;
}

export const CITATION_API_VERSION = 1;

/**
 * Factory creating the namespaced citation API bound to a registry instance.
 */
export function createCitationApi(registry: CitationEngineRegistry): FeuilletsCitationApi {
  return {
    apiVersion: CITATION_API_VERSION,
    registerProvider: (provider) => registry.register(provider),
    unregisterProvider: (providerId) => {
      registry.unregister(providerId);
    },
    getProvider: (providerId) => registry.get(providerId),
  };
}
