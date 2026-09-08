import Svg, { Path } from 'react-native-svg'

/**
 * The CHIP mark.
 *
 * Two lobes crossed by two vertical rules — the figure MyCHIPs draws
 * (`chark/assets/svg/ic_chit.svg`), and the same idea as `$` or `¥`: a form with
 * strokes through it. It was first attempted as an overstruck `8`, which reads
 * as the digit eight beside a number; the shape has to be its own, so it is
 * drawn.
 *
 * Sized from the text it sits with and inheriting its colour, so it scales with
 * the figure and needs no glyph coverage on the reader's device.
 */
export function ChitMark({ size, colour }: { size: number; colour: string }): React.JSX.Element {
	return (
		<Svg width={size * (18 / 32)} height={size} viewBox="0 0 18 32">
			<Path
				d="M9.01343 16.0242C14.2136 13.5061 17.4176 9.84796 16.956 7.41098C16.444 4.7146 11.514 3.86991 8.77825 3.92178C6.40895 3.96568 1.57955 4.75717 1.07091 7.41098C0.60711 9.83332 3.81103 13.4569 9.01343 16.0242Z"
				stroke={colour}
				strokeWidth={2}
				strokeMiterlimit={10}
				fill="none"
			/>
			<Path
				d="M8.98391 16.0703C3.77932 18.5871 0.579776 22.2506 1.04467 24.6835C1.5555 27.3786 6.48553 28.2233 9.22128 28.1727C11.5906 28.1288 16.42 27.3374 16.9286 24.6835C17.3902 22.2599 14.1863 18.6377 8.98391 16.0703Z"
				stroke={colour}
				strokeWidth={2}
				strokeMiterlimit={10}
				fill="none"
			/>
			<Path d="M7.01716 0H5.53717V32H7.01716V0Z" fill={colour} />
			<Path d="M12.4668 0H10.9868V32H12.4668V0Z" fill={colour} />
		</Svg>
	)
}
