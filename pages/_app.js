// pages/_app.js
import ErrorBoundary from '../components/ErrorBoundary';
import '../styles/globals.css'; // if you have global styles

export default function MyApp({ Component, pageProps }) {
  return (
    <ErrorBoundary>
      <Component {...pageProps} />
    </ErrorBoundary>
  );
}
