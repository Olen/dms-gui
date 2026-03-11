import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container mt-4">
          <div className="alert alert-danger">
            <h4 className="alert-heading">Something went wrong</h4>
            <p>{this.state.error?.message || 'Unknown error'}</p>
            {this.state.errorInfo && (
              <pre className="small mt-2" style={{maxHeight: '200px', overflow: 'auto'}}>
                {this.state.errorInfo.componentStack}
              </pre>
            )}
            <hr />
            <button className="btn btn-outline-danger" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
