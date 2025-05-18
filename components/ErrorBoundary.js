// components/ErrorBoundary.js
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true };
  }

  componentDidCatch(err, info) {
    console.error("ErrorBoundary caught:", err, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: 'red' }}>
          Oops—something went wrong. Please try again.
        </div>
      );
    }
    return this.props.children;
  }
}
