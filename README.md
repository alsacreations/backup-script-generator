# Générateur de script rclone backup

Une petite application web statique qui permet de générer facilement un script de sauvegarde `rclone` depuis un formulaire visuel.

## Description

Cette application permet de créer des scripts de sauvegarde `rclone` en remplissant un formulaire simple. Les fonctionnalités incluent :

- génération de script `rclone sync` ou `rclone copy`
- configuration des sources et destinations de sauvegarde
- ajout de plusieurs entrées de sauvegarde
- création de lignes de cron simples
- copie ou téléchargement du script généré

## Utilisation

1. Ouvrez `index.html` dans un navigateur web.
2. Remplissez les champs du formulaire :
   - source locale
   - destination rclone
   - options de sauvegarde
3. Ajoutez autant d’entrées de sauvegarde que nécessaire.
4. Copiez ou téléchargez le script généré depuis la zone de sortie.
5. (Optionnel) utilisez la ligne de cron générée pour planifier l’exécution.

## Structure du projet

- `index.html` : single-page HTML
- `script.js` : fichier JavaScript séparé pour gérer la logique de l'application.
- `style.css` : fichier CSS séparé pour le style de l'application.

## Licence

Aucune licence spécifique n’est fournie. Utilisez ce projet librement selon vos besoins.

## TODO

Documenter la façon d'installer rclone et de le configurer initialement.
