import { nowSerial } from './engine/dates'
export const dateSerialNow = () => nowSerial()
export const uid = () => Math.random().toString(36).slice(2, 10)
