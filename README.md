# SpeakUp AI

This is a simple web app that helps users practice English conversation.
The main page is `index.html` which loads language files from the `lang` folder
and uses a small custom stylesheet `style.css` for UI tweaks and animations.

Open `index.html` in a browser to try it out. Click the star next to any message during a conversation to save it as a favorite. Click the star again to remove it. Use the star button in the header to see all of your saved lines in one place.

## Configuration

The app sends prompts to an external API. The endpoint URL can be customised by
editing `config.js` at the project root. The file exposes a global
`APP_CONFIG` object:

```javascript
window.APP_CONFIG = {
  API_ENDPOINT: 'https://your-server.example.com/generate'
};
```

If you run the app in a Node environment (e.g. during tests), you may instead
set the `API_ENDPOINT` environment variable.
