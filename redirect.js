const destination = new URL('https://wealth-tracker-app.pages.dev/');
destination.search = window.location.search;
destination.hash = window.location.hash;
window.location.replace(destination.href);
