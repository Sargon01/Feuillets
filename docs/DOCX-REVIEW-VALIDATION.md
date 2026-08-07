# Validation Révision DOCX

## Workflow

Markdown Feuillets
→ export DOCX
→ révision Word
→ Révision DOCX
→ décision de l’auteur
→ réintégration Markdown

## Fonctionnalités validées

- insertions ;
- suppressions ;
- remplacements ;
- commentaires ;
- commentaires résolus Word ;
- déplacements natifs ;
- couper-coller implicite ;
- déplacements multi-paragraphes ;
- déplacements inter-feuillets ;
- notes de bas de page ;
- plusieurs notes dans un déplacement ;
- collisions de labels ;
- protection de la structure Markdown ;
- transactionnalité ;
- snapshots ;
- traçabilité ;
- comparaison avant/après.

## Principes de sécurité

- Markdown reste source de vérité ;
- `Ambigu` jamais appliqué directement ;
- `À vérifier` demande une décision explicite ;
- snapshots avant écriture ;
- multi-fichiers transactionnels ;
- rollback contrôlé ;
- aucune heuristique risquée en cas de doute.

## Validation réelle

Factuellement, plusieurs cycles réels d'aller-retour :

Feuillets → Word → Feuillets

ont déjà validé notamment :
- corrections simples et complexes ;
- commentaires ;
- déplacements inter-feuillets ;
- notes transférées ;
- collisions de labels ;
- génération de vraies notes Word après réexport ;
- comparaison avec snapshots.

## Limites actuelles

- révisions avancées de mise en forme → Lot 8 ;
- génération d’un DOCX révisé conservant l’état éditorial → Lot 9.
