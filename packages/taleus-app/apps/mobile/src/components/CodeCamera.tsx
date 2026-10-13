import { useEffect, useRef } from 'react'
import { Text, View } from 'react-native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import { useBarcodeScannerOutput } from 'react-native-vision-camera-barcode-scanner'

import { t } from '../i18n'
import { useStyles, spacing, type as typography, type Tokens } from '../theme'

/**
 * The rear camera, reading QR codes (`specs/mobile/screens/scan.md`). Each distinct code is reported
 * once, however many frames show it. Permission is asked when it mounts; refused, it says how to
 * allow it, and the screen around it keeps working without a camera.
 */
export function CodeCamera({ active, onCode }: { active: boolean; onCode(value: string): void }): React.JSX.Element {
	const styles = useStyles(make)
	const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission()
	const seen = useRef<string | undefined>(undefined)

	useEffect(() => {
		if (!hasPermission && canRequestPermission) void requestPermission()
	}, [hasPermission, canRequestPermission, requestPermission])

	if (!hasPermission) {
		return (
			<View style={[styles.frame, styles.blocked]}>
				<Text style={styles.caption}>
					{canRequestPermission ? t('screens.scan.camera-asking') : t('screens.scan.camera-refused')}
				</Text>
			</View>
		)
	}

	return (
		<View style={styles.frame}>
			<Viewfinder
				active={active}
				onCode={value => {
					if (value === seen.current) return
					seen.current = value
					onCode(value)
				}}
			/>
		</View>
	)
}

/**
 * The rear camera with a QR reader attached. The camera list arrives a moment after permission is
 * granted (and never, on a device without one), so until there is a device it says so instead of
 * mounting the camera -- the library's own `CodeScanner` throws in that moment.
 */
function Viewfinder({ active, onCode }: { active: boolean; onCode(value: string): void }): React.JSX.Element {
	const styles = useStyles(make)
	const device = useCameraDevice('back')
	const reader = useBarcodeScannerOutput({
		barcodeFormats: ['qr-code'],
		onBarcodeScanned: codes => {
			const value = codes.find(code => code.rawValue)?.rawValue
			if (value) onCode(value)
		},
		onError: error => console.warn('[CodeCamera] scanning failed:', error),
	})
	if (!device) {
		return (
			<View style={styles.blocked}>
				<Text style={styles.caption}>{t('screens.scan.camera-missing')}</Text>
			</View>
		)
	}
	return (
		<Camera
			style={styles.camera}
			isActive={active}
			device={device}
			outputs={[reader]}
			onError={error => console.warn('[CodeCamera] camera failed:', error)}
		/>
	)
}

const make = (tokens: Tokens) => ({
	frame: { height: 280, borderRadius: spacing[2], overflow: 'hidden' as const, backgroundColor: tokens.surface },
	camera: { flex: 1 },
	blocked: { flex: 1, justifyContent: 'center' as const, padding: spacing[3] },
	caption: { ...typography.caption, color: tokens.textSecondary, textAlign: 'center' as const },
})
