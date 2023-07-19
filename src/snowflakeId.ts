import * as _ from 'lodash'

// NewCompute SnowFlake (IEEE 754 floating point number compatible)
// [42 bit date][5 bit enum][5 bit counter]

const NEWCOMPUTE_EPOCH = 1689206400000
const DATE_BITS        = 42
const COUNTER_BITS     = 5
const EXTRA_BITS       = 5

let counter = 0 // hook up to redis eventually. localized for now

export const getNextId = (extraValue: number) => {
  const count = BigInt.asIntN(COUNTER_BITS, BigInt(getCount()))
  const extra = BigInt.asIntN(EXTRA_BITS, BigInt(extraValue)) << BigInt(COUNTER_BITS);
  const detail = extra | count

  return (getTimeBigNum(new Date()) | detail).toString()
}

export const getTime = (date?: Date) => {
  date = _.isNil(date) ? new Date() : date
  return getTimeBigNum(date).toString()
}

const getTimeBigNum = (date: Date): bigint => {
  let timestamp = (date).getTime() - NEWCOMPUTE_EPOCH
  return BigInt.asIntN(DATE_BITS, BigInt(timestamp)) << BigInt(COUNTER_BITS + EXTRA_BITS)
}

const getCount = (): number => {
    const count = counter
    if (counter < Math.pow(2, COUNTER_BITS)) {
        counter += 1
    } else {
        counter = 1
    }
    return count
}