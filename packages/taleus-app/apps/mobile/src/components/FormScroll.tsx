import { useEffect, useRef, useState } from 'react'
import {
	Keyboard,
	Platform,
	ScrollView,
	TextInput,
	View,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	type ScrollViewInstance,
	type ScrollViewProps,
} from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import { spacing } from '../theme'

/**
 * The scroll view for any screen with a text field (`global/ui.md`, "The on-screen keyboard").
 *
 * It scrolls the focused field clear of the keyboard. React Native's own avoidance relies on the
 * window being resized, which an edge-to-edge window (React Native 0.87, every Android version)
 * never is. And a tap on a control while the keyboard is up acts on the control, rather than being
 * spent on dismissing the keyboard.
 *
 * react-native-keyboard-controller does the work, as in sereus chat and health -- except below
 * Android 11. There the library has no keyboard animation callbacks and rebuilds them from window
 * insets, and in this app it saw no keyboard at all (Galaxy S7, Android 8, 2026-10-12; Android 16
 * and iOS are unaffected). Those phones get `ResizingScroll`, built on React Native's own `Keyboard`
 * events, which do arrive there.
 */
export function FormScroll(props: ScrollViewProps): React.JSX.Element {
	return INSETS_EMULATED ? (
		<ResizingScroll {...props} />
	) : (
		<KeyboardAwareScrollView keyboardShouldPersistTaps="handled" bottomOffset={spacing[4]} {...props} />
	)
}

/** Below Android 11 (API 30), where keyboard animation callbacks are emulated from window insets. */
const INSETS_EMULATED = Platform.OS === 'android' && Platform.Version < 30

/**
 * While the keyboard is up, room below the content as tall as the keyboard, and the focused field
 * scrolled to just above it. The field is measured in the window: React Native's
 * `scrollResponderScrollNativeHandleToKeyboard` measures it within the content, as though the scroll
 * view began at the top of the screen, so below a header it stopped short by the header's height.
 */
function ResizingScroll({ children, onScroll, ...props }: ScrollViewProps): React.JSX.Element {
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
