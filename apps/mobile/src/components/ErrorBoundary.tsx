import type { PropsWithChildren, ReactNode } from "react";
import { Component, type ErrorInfo } from "react";
import { Text, View } from "react-native";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("App render error:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: "#020617", padding: 24, justifyContent: "center" }}>
          <Text style={{ color: "#f87171", fontSize: 18, fontWeight: "700", marginBottom: 12 }}>
            Something went wrong
          </Text>
          <Text style={{ color: "#e2e8f0", fontSize: 15, lineHeight: 22 }}>
            Please try again.
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}
