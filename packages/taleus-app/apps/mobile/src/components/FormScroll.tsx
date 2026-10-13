import { useEffect, useRef, useState } from 'react'
import {
	Keyboard,
	ScrollView,
	TextInput,
	View,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	type ScrollViewInstance,
	type ScrollViewProps,
} from 'react-native'

import { spacing } from '../theme'

/**
 * The scroll view for any screen with a text field (`global/ui.md`, "The on-screen keyboard").
 *
 * React Native 0.87 draws edge-to-edge on every Android version, and an edge-to-edge window is never
 * resized for the keyboard, so a field low on the screen sat under it. While the keyboard is up this
 * adds its height below the content, so everything can scroll clear of it, and scrolls the focused
 * field just above it. It works from React Native's own `Keyboard` events: react-native-keyboard-controller
 * (sereus chat's choice) reported no keyboard at all on the Galaxy S7 (Android 8) here. And it
 * measures the field in the window itself: `scrollResponderScrollNativeHandleToKeyboard` measures it
 * within the content, as though the scroll view began at the top of the screen, so below a header it
 * stops short by the header's height.
 *
 * A tap on a control while the keyboard is up acts on the control, rather than being spent on
 * dismissing the keyboard.
 */
export function FormScroll({ children, onScroll, ...props }: ScrollViewProps): React.JSX.Element {
	const scroll = useRef<ScrollViewInstance>(null)
	const offset = useRef(0)
	const keyboard = useKeyboard()

	const tracked = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		offset.current = event.nativeEvent.contentOffset.y
		onScroll?.(event)
	}

	// Once the room below the content is laid out: scrolled any sooner, the view stops short at the
	// old content height.
	const revealFocused = () => {
		const input = keyboard ? TextInput.State.currentlyFocusedInput() : null
		input?.measureInWindow((_x, y, _width, height) => {
			const hidden = y + height + spacing[4] - (keyboard?.top ?? 0)
			if (hidden > 0) scroll.current?.scrollTo({ y: offset.current + hidden, animated: true })
		})
	}

	return (
		<ScrollView ref={scroll} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={tracked} {...props}>
			{children}
			<View style={{ height: keyboard?.height ?? 0 }} onLayout={revealFocused} />
		</ScrollView>
	)
}

/** Where the keyboard is while it is up, in window coordinates; undefined otherwise. */
function useKeyboard(): { top: number; height: number } | undefined {
	const [keyboard, setKeyboard] = useState<{ top: number; height: number }>()
	useEffect(() => {
		const shown = Keyboard.addListener('keyboardDidShow', event =>
			setKeyboard({ top: event.endCoordinates.screenY, height: event.endCoordinates.height }),
		)
		const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(undefined))
		return () => {
			shown.remove()
			hidden.remove()
		}
	}, [])
	return keyboard
}
