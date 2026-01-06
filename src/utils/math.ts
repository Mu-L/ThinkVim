import { Decimal } from 'decimal.js';

// Configure decimal.js for high precision
Decimal.set({ precision: 50, rounding: 4 });

export class MathUtils {
  /**
   * Calculate implied probability from odds
   * @param odds Decimal odds (e.g., 2.5 for 2.5x return)
   * @returns Probability as Decimal (0-1)
   */
  static oddsToProbability(odds: Decimal): Decimal {
    return new Decimal(1).div(odds.plus(1));
  }

  /**
   * Calculate odds from probability
   * @param probability Decimal probability (0-1)
   * @returns Odds as Decimal
   */
  static probabilityToOdds(probability: Decimal): Decimal {
    return probability.div(new Decimal(1).minus(probability));
  }

  /**
   * Calculate the spread between YES and NO prices
   * @param yesPrice Price of YES token
   * @param noPrice Price of NO token
   * @returns Spread as Decimal
   */
  static calculateSpread(yesPrice: Decimal, noPrice: Decimal): Decimal {
    return yesPrice.plus(noPrice).minus(1);
  }

  /**
   * Calculate arbitrage opportunity
   * @param yesPrice Price of YES token
   * @param noPrice Price of NO token
   * @param fee Trading fee as percentage
   * @returns Positive value indicates arbitrage opportunity
   */
  static calculateArbitrage(yesPrice: Decimal, noPrice: Decimal, fee: Decimal): Decimal {
    const total = yesPrice.plus(noPrice);
    const feeAmount = total.mul(fee);
    return total.minus(1).minus(feeAmount);
  }

  /**
   * Calculate position size based on risk
   * @param accountBalance Current account balance
   * @param riskPercent Risk percentage per trade (0-1)
   * @param stopLoss Stop loss percentage (0-1)
   * @returns Position size as Decimal
   */
  static calculatePositionSize(accountBalance: Decimal, riskPercent: Decimal, stopLoss: Decimal): Decimal {
    return accountBalance.mul(riskPercent).div(stopLoss);
  }

  /**
   * Calculate percentage change
   * @param oldValue Previous value
   * @param newValue New value
   * @returns Percentage change as Decimal
   */
  static calculatePercentChange(oldValue: Decimal, newValue: Decimal): Decimal {
    if (oldValue.isZero()) return new Decimal(0);
    return newValue.minus(oldValue).div(oldValue).mul(100);
  }

  /**
   * Calculate exponential moving average
   * @param values Array of values
   * @param period EMA period
   * @returns EMA value
   */
  static calculateEMA(values: Decimal[], period: number): Decimal {
    if (values.length === 0) return new Decimal(0);
    if (values.length === 1) return values[0];

    const multiplier = new Decimal(2).div(new Decimal(period).plus(1));
    let ema = values[0];

    for (let i = 1; i < values.length; i++) {
      ema = values[i].mul(multiplier).plus(ema.mul(new Decimal(1).minus(multiplier)));
    }

    return ema;
  }

  /**
   * Calculate standard deviation
   * @param values Array of values
   * @param isPopulation True for population std dev, false for sample
   * @returns Standard deviation
   */
  static calculateStdDev(values: Decimal[], isPopulation: boolean = false): Decimal {
    if (values.length < 2) return new Decimal(0);

    const mean = values.reduce((sum, val) => sum.plus(val), new Decimal(0)).div(values.length);
    const squaredDiffs = values.map(val => val.minus(mean).pow(2));
    const variance = squaredDiffs.reduce((sum, val) => sum.plus(val), new Decimal(0))
      .div(isPopulation ? values.length : values.length - 1);

    return variance.sqrt();
  }

  /**
   * Round to significant figures
   * @param value Value to round
   * @param sigFigs Number of significant figures
   * @returns Rounded value
   */
  static toSignificantFigures(value: Decimal, sigFigs: number): Decimal {
    if (value.isZero()) return value;

    const magnitude = value.abs().log().div(Math.log(10)).floor();
    const scale = new Decimal(10).pow(magnitude.minus(sigFigs).plus(1));
    return value.div(scale).round().mul(scale);
  }
}

export default MathUtils;
