import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StylesPane from '../StylesPane';

describe('StylesPane', () => {
  it('renders loading state when styles is null', () => {
    render(<StylesPane styles={null} />);
    expect(screen.getByText('Loading styles...')).toBeInTheDocument();
  });

  it('renders empty state when styles is {}', () => {
    render(<StylesPane styles={{}} />);
    expect(screen.getByText('No styles found')).toBeInTheDocument();
  });

  it('renders table with styles data', () => {
    const styles = {
      color: 'red',
   fontSize: '16px',
      margin: '10px',
    };
    render(<StylesPane styles={styles} />);

    // Check table headers
    expect(screen.getByText('Property')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();

    // Check style properties
    expect(screen.getByText('color')).toBeInTheDocument();
    expect(screen.getByText('red')).toBeInTheDocument();
    expect(screen.getByText('fontSize')).toBeInTheDocument();
    expect(screen.getByText('16px')).toBeInTheDocument();
    expect(screen.getByText('margin')).toBeInTheDocument();
    expect(screen.getByText('10px')).toBeInTheDocument();

    // Check count display
    expect(screen.getByText('3 / 3 styles')).toBeInTheDocument();
  });

  it('filters styles by search input', async () => {
    const user = userEvent.setup();
    const styles = {
      color: 'red',
      backgroundColor: 'blue',
      fontSize: '16px',
      lineHeight: '1.5',
    };

    render(<StylesPane styles={styles} />);

    // Initially all styles shown
    expect(screen.getByText('4 / 4 styles')).toBeInTheDocument();

    // Filter by property name
    const input = screen.getByPlaceholderText(/Filter by property or value/i);
    await user.type(input, 'color');

    // Should show only color and backgroundColor
    expect(screen.getByText('2 / 4 styles')).toBeInTheDocument();
    expect(screen.getByText('color')).toBeInTheDocument();
    expect(screen.getByText('backgroundColor')).toBeInTheDocument();
    expect(screen.queryByText('fontSize')).not.toBeInTheDocument();
  });

  it('filters styles by value', async () => {
    const user = userEvent.setup();
    const styles = {
      color: 'red',
      backgroundColor: 'blue',
      borderColor: 'red',
    };

    render(<StylesPane styles={styles} />);

    const input = screen.getByPlaceholderText(/Filter by property or value/i);
    await user.type(input, 'red');

    // Should show color and borderColor
    expect(screen.getByText('2 / 3 styles')).toBeInTheDocument();
    expect(screen.queryByText('backgroundColor')).not.toBeInTheDocument();
  });

  it('truncates long values', () => {
    const longValue = 'a'.repeat(150);
    const styles = {
      backgroundImage: longValue,
    };

    render(<StylesPane styles={styles} />);

    const valueCell = screen.getByText(/^a+\.\.\.$/);
    expect(valueCell).toBeInTheDocument();
    expect(valueCell.textContent).toHaveLength(103); // 100 chars + '...'
    expect(valueCell).toHaveAttribute('title', longValue);
  });

  it('shows "No styles match filter" when filter has no results', async () => {
    const user = userEvent.setup();
    const styles = {
      color: 'red',
      fontSize: '16px',
    };

    render(<StylesPane styles={styles} />);

    const input = screen.getByPlaceholderText(/Filter by property or value/i);
    await user.type(input, 'nonexistent');

    expect(screen.getByText('No styles match filter')).toBeInTheDocument();
    expect(screen.getByText('0 / 2 styles')).toBeInTheDocument();
  });
});
