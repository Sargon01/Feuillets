/* Redirige `import ... from "obsidian"` vers le stub local pendant les
   tests. Le paquet npm "obsidian" ne contient que des types (main: ""), il
   n'est donc pas importable à l'exécution. */

const stub = new URL("./obsidian-stub.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "obsidian") return { url: stub, shortCircuit: true };
  return nextResolve(specifier, context);
}
