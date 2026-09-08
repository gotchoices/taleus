import { Component, type ReactNode } from 'react'
import { ScrollView, Text } from 'react-native'

/**
 * A render error in a release build is silent — no redbox, nothing in logcat,
 * just a blank screen. That has cost this project a debugging session more than
 * once, so the app says what happened instead of showing nothing.
 */
interface State {
	error?: Error
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
	state: State = {}

	static getDerivedStateFromError(error: Error): State {
		return { error }
	}

	componentDidCatch(error: Error): void {
		console.error('render failed', error)
	}

	render(): ReactNode {
		const { error } = this.state
		if (!error) {
			return this.props.children
		}
		return (
			<ScrollView style={{ flex: 1, backgroundColor: '#330000' }} contentContainerStyle={{ padding: 16 }}>
				<Text selectable style={{ color: '#ffdddd', fontSize: 16, fontWeight: '600' }}>
					{error.message}
				</Text>
				<Text selectable style={{ color: '#ffbbbb', fontSize: 11, marginTop: 12 }}>
					{error.stack}
				</Text>
			</ScrollView>
		)
	}
}
